import {
	BadRequestException,
	Injectable,
	Logger,
	Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Resend } from 'resend';
import { EmailService } from 'src/notifications/email/email.service';
import { Subscription } from 'src/subscription/schema/subscription.model';
import { PurchaseIntentDto } from './dto/purchase-intent.dto';

@Injectable()
export class PurchaseIntentService {
	private readonly logger = new Logger(PurchaseIntentService.name);
	private readonly resendClient: Pick<Resend, 'contacts'>;

	constructor(
		private readonly emailService: EmailService,
		@InjectModel('Subscription')
		private readonly subscriptionModel: Model<Subscription>,
		@Optional() resendClient?: Pick<Resend, 'contacts'>
	) {
		const apiKey = process.env.RESEND_API_KEY;
		this.resendClient =
			resendClient ?? (apiKey ? new Resend(apiKey) : ({} as Resend));
	}

	async captureIntent(dto: PurchaseIntentDto): Promise<{ success: true }> {
		const plan = await this.subscriptionModel.findById(dto.planId);
		if (!plan || !plan.isActive) {
			// Mensagem genérica de propósito: este endpoint é anônimo e não
			// deve confirmar se um id existe no banco.
			throw new BadRequestException('Plano inválido');
		}

		// O nome vem do banco, nunca do corpo da requisição — é ele que será
		// interpolado no e-mail enviado a partir do nosso domínio.
		const planName = plan.name;

		await this.registerContact(dto, planName);

		try {
			await this.emailService.sendPurchaseIntentConfirmationEmail(
				dto.email,
				planName
			);
		} catch (error) {
			this.logger.warn(
				`Falha ao enviar e-mail de confirmação de interesse: ${error?.message || error}`
			);
		}

		return { success: true };
	}

	private buildContactProperties(dto: PurchaseIntentDto, planName: string) {
		const properties: Record<string, string> = { planName };
		if (dto.utmSource) properties.utmSource = dto.utmSource;
		if (dto.utmMedium) properties.utmMedium = dto.utmMedium;
		if (dto.utmCampaign) properties.utmCampaign = dto.utmCampaign;
		return properties;
	}

	private async registerContact(
		dto: PurchaseIntentDto,
		planName: string
	): Promise<void> {
		const audienceId = process.env.RESEND_AUDIENCE_ID;

		if (!audienceId) {
			this.logger.warn(
				'RESEND_AUDIENCE_ID não configurado; pulando criação de contato na audience'
			);
			return;
		}
		if (!this.resendClient?.contacts) {
			this.logger.warn(
				'RESEND_API_KEY não configurado; pulando criação de contato na audience'
			);
			return;
		}

		const properties = this.buildContactProperties(dto, planName);

		try {
			const { error } = await this.resendClient.contacts.create({
				audienceId,
				email: dto.email,
				properties,
			} as Parameters<Resend['contacts']['create']>[0]);

			if (!error) return;

			await this.updateContact(audienceId, dto.email, properties);
		} catch (error) {
			this.logger.warn(
				`Falha ao criar contato na audience do Resend: ${error?.message || error}`
			);
			await this.updateContact(audienceId, dto.email, properties);
		}
	}

	// Qualquer erro na criação cai para o update, em vez de identificar
	// "contato já existe" pela mensagem: casar texto de erro é frágil entre
	// versões da API. Se o erro era outro, o update falha, loga, e o fluxo
	// segue igual.
	private async updateContact(
		audienceId: string,
		email: string,
		properties: Record<string, string>
	): Promise<void> {
		try {
			const { error } = await this.resendClient.contacts.update({
				audienceId,
				email,
				properties,
			} as Parameters<Resend['contacts']['update']>[0]);

			if (error) {
				this.logger.warn(
					`Falha ao atualizar contato na audience do Resend: ${error?.message || error}`
				);
			}
		} catch (error) {
			this.logger.warn(
				`Falha ao atualizar contato na audience do Resend: ${error?.message || error}`
			);
		}
	}
}
