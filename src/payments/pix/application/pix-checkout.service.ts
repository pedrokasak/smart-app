import {
	BadRequestException,
	ConflictException,
	Inject,
	Injectable,
	Logger,
	NotFoundException,
	ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { isValidCpf, normalizeCpf } from 'src/payments/pix/domain/cpf';
import {
	PIX_CHARGE_TTL_MS,
	pixAmountFor,
	pixDueDate,
	PixInterval,
} from 'src/payments/pix/domain/pix-billing';
import { PixCharge } from 'src/payments/pix/infrastructure/pix-charge.model';
import { Subscription, UserSubscription } from 'src/subscription/schema';
import { User } from 'src/users/schema/user.model';
import {
	PIX_GATEWAY,
	PixGatewayError,
	PixGatewayPort,
	PixUnavailableError,
} from './pix-gateway.port';

/** O que o web precisa para mostrar o QR e acompanhar o pagamento. */
export interface PixChargeView {
	chargeId: string;
	status: PixCharge['status'];
	amount: number;
	interval: PixInterval;
	qrCodePayload?: string;
	qrCodeImage?: string;
	expiresAt?: string;
	periodEnd?: string;
}

export interface CreatePixCheckoutInput {
	planId: string;
	interval: PixInterval;
	cpf?: string;
}

/** Reaproveita o QR pendente só se ainda sobra tempo para pagar. */
const REUSE_MIN_REMAINING_MS = 10 * 60 * 1000;

/**
 * Checkout PIX (TRA-195): emite a cobrança e devolve o QR.
 *
 * Não libera plano nenhum — quem libera é o webhook, depois que o provedor
 * confirma o pagamento. O que o usuário vê aqui é só a instrução de pagamento.
 */
@Injectable()
export class PixCheckoutService {
	private readonly logger = new Logger(PixCheckoutService.name);

	constructor(
		@Inject(PIX_GATEWAY) private readonly gateway: PixGatewayPort,
		@InjectModel('PixCharge')
		private readonly chargeModel: Model<PixCharge>,
		@InjectModel('Subscription')
		private readonly planModel: Model<Subscription>,
		@InjectModel('UserSubscription')
		private readonly userSubscriptionModel: Model<UserSubscription>,
		@InjectModel('User') private readonly userModel: Model<User>
	) {}

	isAvailable(): boolean {
		return this.gateway.isEnabled();
	}

	async createCheckout(
		userId: string,
		input: CreatePixCheckoutInput,
		now: Date = new Date()
	): Promise<PixChargeView> {
		if (!this.gateway.isEnabled()) {
			throw new ServiceUnavailableException(
				'Pagamento por PIX indisponível no momento.'
			);
		}
		if (!Types.ObjectId.isValid(input.planId)) {
			throw new BadRequestException('Plano inválido.');
		}

		const plan = await this.planModel.findById(input.planId);
		const amount = plan ? pixAmountFor(plan, input.interval) : null;
		if (!plan || amount === null) {
			throw new BadRequestException(
				'Este plano não está disponível para pagamento por PIX neste período.'
			);
		}

		await this.assertNoActiveCardSubscription(userId);

		const reusable = await this.findReusableCharge(
			userId,
			input.planId,
			input.interval,
			now
		);
		if (reusable) return this.toView(reusable);

		const customerId = await this.ensureCustomer(userId, input.cpf);

		const charge = await this.chargeModel.create({
			user: new Types.ObjectId(userId),
			plan: plan._id,
			interval: input.interval,
			amount,
			status: 'pending',
			asaasCustomerId: customerId,
		});

		try {
			const { paymentId } = await this.gateway.createCharge({
				customerId,
				value: amount,
				dueDate: pixDueDate(now),
				description: `Trackerr ${plan.name} · ${
					input.interval === 'year' ? 'anual' : 'mensal'
				}`,
				externalReference: String(charge._id),
			});
			charge.asaasPaymentId = paymentId;
			// Grava o id ANTES de pedir o QR: se a próxima chamada falhar, o
			// webhook de um pagamento feito por outro caminho ainda concilia.
			await charge.save();

			const qr = await this.gateway.getQrCode(paymentId);
			charge.qrCodePayload = qr.payload;
			charge.qrCodeImage = qr.encodedImage;
			charge.expiresAt = Number.isNaN(qr.expiresAt.getTime())
				? new Date(now.getTime() + PIX_CHARGE_TTL_MS)
				: qr.expiresAt;
			await charge.save();
		} catch (error) {
			if (!charge.asaasPaymentId) {
				charge.status = 'failed';
				await charge.save();
			}
			throw this.translateGatewayError(error);
		}

		return this.toView(charge);
	}

	/** Consulta para o polling do web. Só o dono enxerga a cobrança. */
	async getCharge(userId: string, chargeId: string): Promise<PixChargeView> {
		if (!Types.ObjectId.isValid(chargeId)) {
			throw new NotFoundException('Cobrança não encontrada.');
		}
		const charge = await this.chargeModel.findOne({
			_id: new Types.ObjectId(chargeId),
			user: new Types.ObjectId(userId),
		});
		if (!charge) throw new NotFoundException('Cobrança não encontrada.');
		return this.toView(charge);
	}

	/**
	 * Cartão ativo no Stripe + PIX pago = cobrança em dobro pelo mesmo
	 * período. Melhor recusar antes de gerar o QR.
	 */
	private async assertNoActiveCardSubscription(userId: string): Promise<void> {
		const current = await this.userSubscriptionModel.findOne({
			user: new Types.ObjectId(userId),
			status: 'active',
			stripeSubscriptionId: { $exists: true, $nin: [null, ''] },
			currentPeriodEnd: { $gte: new Date() },
		});
		if (current) {
			throw new ConflictException(
				'Você já tem uma assinatura ativa no cartão. Gerencie ou cancele por lá antes de pagar com PIX.'
			);
		}
	}

	private async findReusableCharge(
		userId: string,
		planId: string,
		interval: PixInterval,
		now: Date
	): Promise<PixCharge | null> {
		return this.chargeModel.findOne({
			user: new Types.ObjectId(userId),
			plan: new Types.ObjectId(planId),
			interval,
			status: 'pending',
			qrCodePayload: { $exists: true },
			expiresAt: { $gt: new Date(now.getTime() + REUSE_MIN_REMAINING_MS) },
		});
	}

	/**
	 * Cliente no provedor: criado uma vez e reaproveitado. O CPF só é exigido
	 * na primeira compra e NÃO é gravado no Trackerr — fica no provedor, que é
	 * quem precisa dele para emitir a cobrança (minimização, LGPD).
	 */
	private async ensureCustomer(
		userId: string,
		rawCpf?: string
	): Promise<string> {
		const user = await this.userModel
			.findById(userId)
			.select('email firstName lastName asaasCustomerId');
		if (!user) throw new NotFoundException('Usuário não encontrado.');
		if (user.asaasCustomerId) return user.asaasCustomerId;

		if (!isValidCpf(rawCpf)) {
			throw new BadRequestException({
				statusCode: 400,
				error: 'PIX_CPF_REQUIRED',
				message: 'Informe um CPF válido para pagar com PIX.',
			});
		}

		try {
			const customerId = await this.gateway.createCustomer({
				name:
					[user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
					user.email,
				email: user.email,
				cpf: normalizeCpf(rawCpf)!,
				externalReference: String(user._id),
			});
			await this.userModel.updateOne(
				{ _id: user._id },
				{ $set: { asaasCustomerId: customerId } }
			);
			return customerId;
		} catch (error) {
			throw this.translateGatewayError(error);
		}
	}

	private translateGatewayError(error: unknown): Error {
		if (error instanceof PixUnavailableError) {
			return new ServiceUnavailableException(
				'Pagamento por PIX indisponível no momento.'
			);
		}
		if (error instanceof PixGatewayError) {
			return new BadRequestException(error.message);
		}
		this.logger.error(
			`Falha inesperada no checkout PIX: ${(error as Error)?.message}`
		);
		return error as Error;
	}

	private toView(charge: PixCharge): PixChargeView {
		return {
			chargeId: String(charge._id),
			status: charge.status,
			amount: charge.amount,
			interval: charge.interval,
			qrCodePayload:
				charge.status === 'pending' ? charge.qrCodePayload : undefined,
			qrCodeImage: charge.status === 'pending' ? charge.qrCodeImage : undefined,
			expiresAt: charge.expiresAt?.toISOString(),
			periodEnd: charge.periodEnd?.toISOString(),
		};
	}
}
