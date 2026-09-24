import {
	BadRequestException,
	Injectable,
	InternalServerErrorException,
	Logger,
	NotFoundException,
	OnModuleInit,
} from '@nestjs/common';
import {
	countUsers,
	UserCounter,
} from 'src/admin/application/user-activity-metrics';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Role } from 'src/auth/enums/role.enum';
import {
	isStripeResourceMissing,
	StripeService,
} from 'src/subscription/stripe.service';
import { Subscription, UserSubscription } from 'src/subscription/schema';
import { EmailService } from 'src/notifications/email/email.service';
import { CreateSubscriptionDto } from 'src/subscription/dto/create-subscription.dto';
import { UpdateSubscriptionDto } from 'src/subscription/dto/update-subscription.dto';
import { User } from 'src/users/schema/user.model';
import {
	INITIAL_ADMIN_EMAIL,
	ManualGrantType,
} from './constants/admin.constants';
import { ManualGrantAudit } from './schema/manual-grant-audit.model';
import { ManualGrantDto } from './dto/manual-grant.dto';
import {
	AdminOverviewResponse,
	PlanUsageMetric,
} from './dto/admin-overview.dto';
import {
	ListManualGrantsQueryDto,
	ListManualGrantsResponse,
} from './dto/list-manual-grants.dto';

@Injectable()
export class AdminService implements OnModuleInit {
	private readonly logger = new Logger(AdminService.name);

	constructor(
		@InjectModel('User') private readonly userModel: Model<User>,
		@InjectModel('Subscription')
		private readonly subscriptionModel: Model<Subscription>,
		@InjectModel('UserSubscription')
		private readonly userSubscriptionModel: Model<UserSubscription>,
		@InjectModel('ManualGrantAudit')
		private readonly manualGrantAuditModel: Model<ManualGrantAudit>,
		private readonly stripeService: StripeService,
		private readonly emailService: EmailService
	) {}

	async onModuleInit() {
		await this.ensureInitialAdminRole();
	}

	async ensureInitialAdminRole() {
		const user = await this.userModel.findOne({ email: INITIAL_ADMIN_EMAIL });
		if (!user || user.role === Role.Admin) {
			return;
		}

		user.role = Role.Admin;
		await user.save();
		this.logger.log(`Role admin garantida para ${INITIAL_ADMIN_EMAIL}`);
	}

	async createPlan(dto: CreateSubscriptionDto) {
		let stripeProductId = dto.stripeProductId;
		if (!stripeProductId) {
			const product = await this.stripeService.createProduct(
				dto.name,
				dto.description
			);
			stripeProductId = product.id;
		}

		let stripePriceId = dto.stripePriceId;
		if (!stripePriceId) {
			const price = await this.stripeService.createPrice(
				stripeProductId,
				dto.price,
				dto.currency || 'brl',
				dto.interval,
				dto.intervalCount || 1
			);
			stripePriceId = price.id;
		}

		// Plano com preço anual já sobe provisionado no Stripe — sem isso o
		// admin precisaria copiar o ID do preço anual do dashboard na mão
		// (TRA-188). `annualStripePriceId` do payload é ignorado: o vínculo é
		// sempre derivado do valor de `annualPrice`, nunca colado.
		let annualStripePriceId: string | undefined;
		if (dto.annualPrice) {
			const annualStripePrice = await this.stripeService.createPrice(
				stripeProductId,
				dto.annualPrice,
				dto.currency || 'brl',
				'year',
				1
			);
			annualStripePriceId = annualStripePrice.id;
		}

		const created = await this.subscriptionModel.create({
			...dto,
			currency: dto.currency || 'brl',
			intervalCount: dto.intervalCount || 1,
			stripeProductId,
			stripePriceId,
			annualStripePriceId,
			// Plano nasceu no painel, não no seed canônico: o admin já é dono
			// do conteúdo desde a criação — o próximo boot do plan-sync não
			// deve sobrescrever nada aqui (TRA-188).
			catalogManaged: false,
		});

		return created;
	}

	async listPlans() {
		const plans = await this.subscriptionModel.find().sort({ createdAt: -1 });

		const counts = await this.userSubscriptionModel.aggregate([
			{ $match: { status: { $in: ['active', 'trialing'] } } },
			{ $group: { _id: '$plan', count: { $sum: 1 } } },
		]);
		const countsByPlanId = new Map(
			counts.map((item) => [String(item._id), Number(item.count)])
		);

		return plans.map((plan) => ({
			...plan.toObject(),
			activeSubscriberCount: countsByPlanId.get(String(plan._id)) || 0,
		}));
	}

	// Status básico do webhook Stripe: apenas confirma via env se o secret
	// está configurado no server (TRA-115). Não faz handshake real com o Stripe.
	getWebhookStatus() {
		return this.stripeService.getWebhookStatus();
	}

	// Eventos recentes vindos direto da Stripe Events API — sem persistência
	// local (TRA-115).
	async listWebhookEvents(limit?: number) {
		let events: Awaited<ReturnType<StripeService['listRecentEvents']>>;
		try {
			events = await this.stripeService.listRecentEvents(limit);
		} catch (error) {
			// Sem isto, qualquer falha do Stripe (chave sem permissão de
			// eventos, rate limit, conta errada) virava 500 genérico do
			// NestJS — a tela mostrava "Nenhum evento recente", indistinguível
			// de realmente não ter evento nenhum.
			throw new InternalServerErrorException(
				`Não foi possível listar os eventos do Stripe: ${error?.message ?? 'erro desconhecido'}`
			);
		}
		return events.map((event) => ({
			id: event.id,
			type: event.type,
			created: new Date(event.created * 1000),
			livemode: event.livemode,
		}));
	}

	async updatePlan(id: string, dto: UpdateSubscriptionDto) {
		const plan = await this.subscriptionModel.findById(id);
		if (!plan) {
			throw new NotFoundException('Plano não encontrado');
		}

		const nextName = dto.name ?? plan.name;
		const nextDescription = dto.description ?? plan.description;
		const nextPrice = dto.price ?? plan.price;
		const nextCurrency = dto.currency ?? plan.currency;
		const nextInterval = dto.interval ?? plan.interval;
		const nextIntervalCount = dto.intervalCount ?? plan.intervalCount;
		const nextAnnualPrice = dto.annualPrice ?? plan.annualPrice;
		let nextAnnualStripePriceId = plan.annualStripePriceId;

		const nextIsActive = dto.isActive ?? plan.isActive;
		const productChanged =
			(dto.name && dto.name !== plan.name) ||
			(dto.description !== undefined && dto.description !== plan.description) ||
			(dto.isActive !== undefined && dto.isActive !== plan.isActive);

		const requiresNewPrice =
			nextPrice !== plan.price ||
			nextCurrency !== plan.currency ||
			nextInterval !== plan.interval ||
			nextIntervalCount !== plan.intervalCount;

		// `annualStripePriceId` nunca vem do cliente (TRA-188) — é sempre
		// derivado de `annualPrice`, igual o mensal já é derivado de
		// price/currency/interval. Um ID colado à mão era a única forma de os
		// dois preços ficarem consistentes; agora os dois nascem do mesmo
		// fluxo automático.
		const requiresNewAnnualPrice =
			nextAnnualPrice !== undefined &&
			(nextAnnualPrice !== plan.annualPrice ||
				nextCurrency !== plan.currency ||
				!plan.annualStripePriceId);

		// O preço novo nasce pendurado no produto, então os três caminhos
		// precisam de um vínculo que exista de fato nesta conta Stripe.
		if (productChanged || requiresNewPrice || requiresNewAnnualPrice) {
			plan.stripeProductId = await this.resolveStripeProduct(plan, {
				name: nextName,
				description: nextDescription,
				active: nextIsActive,
			});
		}

		if (requiresNewPrice) {
			if (!plan.stripeProductId) {
				throw new BadRequestException(
					'Plano sem vínculo Stripe. Não é possível gerar novo preço.'
				);
			}
			const stripePrice = await this.stripeService.createPrice(
				plan.stripeProductId,
				nextPrice,
				nextCurrency,
				nextInterval,
				nextIntervalCount
			);
			const oldMonthlyPriceId = plan.stripePriceId;
			plan.stripePriceId = stripePrice.id;
			// Best-effort: o preço substituído fica órfão e ativo na conta se
			// não for arquivado, mas isso nunca deve travar a troca de preço.
			if (oldMonthlyPriceId && oldMonthlyPriceId !== stripePrice.id) {
				await this.archiveStripePriceQuietly(oldMonthlyPriceId);
			}
		}

		if (requiresNewAnnualPrice) {
			if (!plan.stripeProductId) {
				throw new BadRequestException(
					'Plano sem vínculo Stripe. Não é possível gerar novo preço anual.'
				);
			}
			const annualStripePrice = await this.stripeService.createPrice(
				plan.stripeProductId,
				nextAnnualPrice,
				nextCurrency,
				'year',
				1
			);
			const oldAnnualPriceId = plan.annualStripePriceId;
			nextAnnualStripePriceId = annualStripePrice.id;
			if (oldAnnualPriceId && oldAnnualPriceId !== annualStripePrice.id) {
				await this.archiveStripePriceQuietly(oldAnnualPriceId);
			}
		}

		plan.name = nextName;
		plan.description = nextDescription;
		plan.price = nextPrice;
		plan.currency = nextCurrency;
		plan.interval = nextInterval as Subscription['interval'];
		plan.intervalCount = nextIntervalCount;
		plan.annualPrice = nextAnnualPrice;
		plan.annualStripePriceId = nextAnnualStripePriceId;
		if (dto.accessLevel !== undefined) {
			plan.accessLevel = dto.accessLevel;
		}
		if (dto.features) {
			plan.features = dto.features;
		}
		if (dto.capabilities) {
			plan.capabilities = dto.capabilities;
		}
		if (dto.maxUsers !== undefined) {
			plan.maxUsers = dto.maxUsers;
		}
		if (dto.isActive !== undefined) {
			plan.isActive = dto.isActive;
		}
		if (dto.isFeatured !== undefined) {
			plan.isFeatured = dto.isFeatured;
		}
		if (dto.isComingSoon !== undefined) {
			plan.isComingSoon = dto.isComingSoon;
		}
		// Toda edição pelo painel tira o plano do piloto automático do seed
		// canônico (TRA-188) — sem isso o próximo boot do plan-sync reverteria
		// exatamente o que acabou de ser salvo aqui.
		plan.catalogManaged = false;
		await plan.save();

		return plan;
	}

	/**
	 * Arquiva (`active: false`) um preço substituído no Stripe. Falha aqui
	 * nunca derruba a troca de preço em si — só deixa um preço órfão ativo
	 * na conta, que é recuperável manualmente; travar o admin por causa disso
	 * seria pior que o problema que resolve.
	 */
	private async archiveStripePriceQuietly(priceId: string): Promise<void> {
		try {
			await this.stripeService.archivePrice(priceId);
		} catch (error) {
			this.logger.warn(
				`Não foi possível arquivar o preço antigo ${priceId} no Stripe (${error?.message}).`
			);
		}
	}

	/**
	 * Devolve um `stripeProductId` que existe na conta da chave em uso.
	 *
	 * O plano pode carregar um produto criado em outro modo (ID de teste num
	 * banco que passou a rodar com chave live). Aí o `products.update`
	 * responde `resource_missing` e derruba a edição inteira — sem nenhuma
	 * saída pela interface, já que o campo não é editável no painel. Nesse
	 * caso o vínculo é refeito na conta atual.
	 *
	 * Só recria quando o plano fica ativo: repor um produto para em seguida
	 * desativá-lo deixaria lixo no Stripe.
	 */
	private async resolveStripeProduct(
		plan: Subscription,
		data: { name?: string; description?: string; active: boolean }
	): Promise<string | undefined> {
		// A Stripe recusa string vazia em parâmetro opcional ("we assume empty
		// values are an attempt to unset"). O painel manda `description` sempre,
		// inclusive em branco, então aqui vazio vira "não mexe no campo".
		const payload = { ...data, description: data.description || undefined };

		if (plan.stripeProductId) {
			try {
				await this.stripeService.updateProduct(plan.stripeProductId, payload);
				return plan.stripeProductId;
			} catch (error) {
				if (!isStripeResourceMissing(error)) throw error;
				this.logger.warn(
					`Produto ${plan.stripeProductId} do plano ${plan._id} não existe na conta Stripe atual; ` +
						'o vínculo será refeito.'
				);
			}
		}

		if (!data.active || !payload.name) return undefined;

		const created = await this.stripeService.createProduct(
			payload.name,
			payload.description
		);
		return created.id;
	}

	async deactivatePlan(id: string) {
		const plan = await this.subscriptionModel.findById(id);
		if (!plan) {
			throw new NotFoundException('Plano não encontrado');
		}

		plan.isActive = false;
		// Antes o plano era salvo primeiro e o Stripe depois: produto de outro
		// modo estourava com o banco já desativado, deixando os dois lados
		// divergentes.
		// Só o `active`: mandar nome e descrição aqui não muda nada no Stripe e
		// ainda arrasta o plano para a rejeição de string vazia.
		plan.stripeProductId = await this.resolveStripeProduct(plan, {
			active: false,
		});
		// Sem isto, um plano ainda `catalogManaged: true` (nunca editado pelo
		// painel antes) volta a `isActive: true` no próximo boot — o
		// plan-sync grava `isActive: true` incondicionalmente em todo plano
		// que ainda não é dono do admin (TRA-188).
		plan.catalogManaged = false;
		await plan.save();

		return { message: 'Plano desativado com sucesso' };
	}

	async updateUserRoleByEmail(email: string, role: Role) {
		const normalizedEmail = email.trim().toLowerCase();
		if (![Role.Admin, Role.Editor].includes(role)) {
			throw new BadRequestException(
				'Apenas roles admin e editor podem ser atribuídas no painel'
			);
		}

		const user = await this.userModel.findOne({ email: normalizedEmail });
		if (!user) {
			throw new NotFoundException('Usuário não encontrado');
		}

		user.role = role;
		await user.save();

		return {
			message: 'Role atualizada com sucesso',
			user: {
				id: String(user._id),
				email: user.email,
				role: user.role,
			},
		};
	}

	async grantSubscriptionByEmail(adminUserId: string, dto: ManualGrantDto) {
		const normalizedEmail = dto.email.trim().toLowerCase();
		const user = await this.userModel.findOne({ email: normalizedEmail });
		if (!user) {
			throw new NotFoundException('Usuário não encontrado');
		}

		const adminUser = await this.userModel.findById(adminUserId);
		if (!adminUser) {
			throw new NotFoundException('Usuário executor não encontrado');
		}

		const plan = await this.subscriptionModel.findById(dto.planId);
		if (!plan || !plan.isActive) {
			throw new NotFoundException('Plano não encontrado ou inativo');
		}

		const isTrial = dto.grantType === ManualGrantType.Trial;
		if (isTrial && !dto.trialDurationDays) {
			throw new BadRequestException(
				'trialDurationDays é obrigatório para concessões do tipo TRIAL'
			);
		}

		const now = new Date();
		const nextStatus = isTrial ? 'trialing' : 'active';
		const nextEndDate = isTrial
			? new Date(now.getTime() + dto.trialDurationDays * 24 * 60 * 60 * 1000)
			: new Date('2099-12-31T23:59:59.999Z');

		const payload = {
			plan: new Types.ObjectId(dto.planId),
			status: nextStatus,
			currentPeriodStart: now,
			currentPeriodEnd: nextEndDate,
			cancelAtPeriodEnd: false,
			trialStart: isTrial ? now : undefined,
			trialEnd: isTrial ? nextEndDate : undefined,
			endedAt: undefined,
			canceledAt: undefined,
			quantity: 1,
		};

		// Upsert atômico (TRA-89): antes era `findOne` e então `save`/`create`,
		// e duas concessões simultâneas pro mesmo usuário — dois admins, ou um
		// duplo clique — não achavam assinatura nenhuma e criavam duas ativas.
		// Uma única operação condicional deixa o banco resolver a corrida.
		const subscriptionRecord =
			await this.userSubscriptionModel.findOneAndUpdate(
				{ user: user._id, status: { $in: ['active', 'trialing'] } },
				{ $set: payload, $setOnInsert: { user: user._id } },
				{ new: true, upsert: true, setDefaultsOnInsert: true }
			);

		await this.manualGrantAuditModel.create({
			user: user._id,
			userEmail: user.email,
			plan: plan._id,
			grantType: dto.grantType,
			trialDurationDays: isTrial ? dto.trialDurationDays : undefined,
			discountPercent: dto.discountPercent,
			performedBy: adminUser._id,
			performedByEmail: adminUser.email,
			notes: dto.notes?.trim() || undefined,
		});

		// A concessão manual não passa pelo Stripe, então não existe recibo
		// nem webhook avisando o usuário (TRA-186). Falha de e-mail não
		// desfaz a concessão — o acesso já está gravado e é o que importa.
		try {
			await this.emailService.sendPlanGrantedEmail({
				email: user.email,
				firstName: (user as { firstName?: string }).firstName,
				planName: plan.name,
				trialDurationDays: isTrial ? dto.trialDurationDays : undefined,
			});
		} catch (error) {
			this.logger.warn(
				`Concessão aplicada para ${user.email}, mas o aviso por e-mail falhou (${error?.message}).`
			);
		}

		return {
			message: 'Concessão manual aplicada com sucesso',
			user: {
				id: String(user._id),
				email: user.email,
			},
			plan: {
				id: String(plan._id),
				name: plan.name,
			},
			subscription: subscriptionRecord,
		};
	}

	async listManualGrants(
		query: ListManualGrantsQueryDto
	): Promise<ListManualGrantsResponse> {
		const page = query.page && query.page > 0 ? query.page : 1;
		const limit = query.limit && query.limit > 0 ? query.limit : 20;
		const skip = (page - 1) * limit;

		const [records, total] = await Promise.all([
			this.manualGrantAuditModel
				.find()
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(limit)
				.populate('plan', 'name')
				.lean(),
			this.manualGrantAuditModel.countDocuments(),
		]);

		// O registro de auditoria é só a concessão em si — não guarda status,
		// porque a assinatura resultante pode mudar depois (renovar, cancelar,
		// virar paga via Stripe). "Ativo"/"Expirado" no handoff reflete o
		// estado ATUAL, então busca a assinatura vigente de cada usuário
		// envolvido numa única query em lote, não uma por linha.
		//
		// `Types.ObjectId.isValid` filtra registros legados/corrompidos sem
		// `user` válido antes de construir a query — um único hex inválido
		// aqui derrubaria a página inteira do histórico de concessões com um
		// erro 500 em vez de só deixar aquele registro sem status calculado.
		const userIds = [
			...new Set(
				records
					.map((record: any) => String(record.user))
					.filter((id) => Types.ObjectId.isValid(id))
			),
		];
		const subscriptions = userIds.length
			? await this.userSubscriptionModel
					.find({ user: { $in: userIds.map((id) => new Types.ObjectId(id)) } })
					.select('user status currentPeriodEnd')
					.lean()
			: [];
		const subscriptionByUserId = new Map(
			subscriptions.map((sub: any) => [String(sub.user), sub])
		);

		const now = new Date();
		const items = records.map((record: any) => {
			const subscription = subscriptionByUserId.get(String(record.user));
			const isActive =
				!!subscription &&
				['active', 'trialing'].includes(subscription.status) &&
				new Date(subscription.currentPeriodEnd) > now;

			return {
				id: String(record._id),
				userEmail: record.userEmail,
				planId: String(record.plan?._id ?? record.plan),
				planName: record.plan?.name ?? 'Plano removido',
				grantType: record.grantType,
				trialDurationDays: record.trialDurationDays,
				discountPercent: record.discountPercent,
				notes: record.notes,
				performedByEmail: record.performedByEmail,
				createdAt: record.createdAt,
				status: (isActive ? 'active' : 'expired') as 'active' | 'expired',
			};
		});

		return { items, page, limit, total };
	}

	async getOverview(): Promise<AdminOverviewResponse> {
		const [activeCount, trialCount, manualGrantCount, planUsageRaw, users] =
			await Promise.all([
				this.userSubscriptionModel.countDocuments({ status: 'active' }),
				this.userSubscriptionModel.countDocuments({ status: 'trialing' }),
				this.manualGrantAuditModel.countDocuments(),
				this.userSubscriptionModel.aggregate([
					{
						$match: {
							status: { $in: ['active', 'trialing'] },
						},
					},
					{
						$group: {
							_id: '$plan',
							count: { $sum: 1 },
						},
					},
					{
						$lookup: {
							from: 'subscriptions',
							localField: '_id',
							foreignField: '_id',
							as: 'plan',
						},
					},
					{
						$project: {
							_id: 0,
							planId: '$_id',
							count: 1,
							planName: {
								$ifNull: [
									{ $arrayElemAt: ['$plan.name', 0] },
									'Plano removido',
								],
							},
						},
					},
					{ $sort: { count: -1, planName: 1 } },
				]),
				countUsers(this.userModel as unknown as UserCounter),
			]);

		const usersByPlan = planUsageRaw.map((item) => ({
			planId: String(item.planId),
			planName: String(item.planName),
			count: Number(item.count),
		})) as PlanUsageMetric[];

		return {
			totalActiveSubscriptions: activeCount,
			totalTrialSubscriptions: trialCount,
			totalManualGrants: manualGrantCount,
			mostUsedPlan: usersByPlan[0] || null,
			usersByPlan,
			users,
		};
	}
}
