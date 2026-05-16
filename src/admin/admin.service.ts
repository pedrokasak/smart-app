import {
	BadRequestException,
	Injectable,
	Logger,
	NotFoundException,
	OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Role } from 'src/auth/enums/role.enum';
import { StripeService } from 'src/subscription/stripe.service';
import {
	Subscription,
	UserSubscription,
} from 'src/subscription/schema';
import { CreateSubscriptionDto } from 'src/subscription/dto/create-subscription.dto';
import { UpdateSubscriptionDto } from 'src/subscription/dto/update-subscription.dto';
import { User } from 'src/users/schema/user.model';
import {
	INITIAL_ADMIN_EMAIL,
	ManualGrantType,
} from './constants/admin.constants';
import { ManualGrantAudit } from './schema/manual-grant-audit.model';
import { ManualGrantDto } from './dto/manual-grant.dto';
import { AdminOverviewResponse, PlanUsageMetric } from './dto/admin-overview.dto';

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
		private readonly stripeService: StripeService
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

		const created = await this.subscriptionModel.create({
			...dto,
			currency: dto.currency || 'brl',
			intervalCount: dto.intervalCount || 1,
			stripeProductId,
			stripePriceId,
		});

		return created;
	}

	async listPlans() {
		return this.subscriptionModel.find().sort({ createdAt: -1 });
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

		if (
			(dto.name && dto.name !== plan.name) ||
			(dto.description !== undefined && dto.description !== plan.description) ||
			(dto.isActive !== undefined && dto.isActive !== plan.isActive)
		) {
			if (plan.stripeProductId) {
				await this.stripeService.updateProduct(plan.stripeProductId, {
					name: nextName,
					description: nextDescription,
					active: dto.isActive ?? plan.isActive,
				});
			}
		}

		const requiresNewPrice =
			nextPrice !== plan.price ||
			nextCurrency !== plan.currency ||
			nextInterval !== plan.interval ||
			nextIntervalCount !== plan.intervalCount;

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
			plan.stripePriceId = stripePrice.id;
		}

		plan.name = nextName;
		plan.description = nextDescription;
		plan.price = nextPrice;
		plan.currency = nextCurrency;
		plan.interval = nextInterval as Subscription['interval'];
		plan.intervalCount = nextIntervalCount;
		if (dto.features) {
			plan.features = dto.features;
		}
		if (dto.maxUsers !== undefined) {
			plan.maxUsers = dto.maxUsers;
		}
		if (dto.isActive !== undefined) {
			plan.isActive = dto.isActive;
		}
		await plan.save();

		return plan;
	}

	async deactivatePlan(id: string) {
		const plan = await this.subscriptionModel.findById(id);
		if (!plan) {
			throw new NotFoundException('Plano não encontrado');
		}

		plan.isActive = false;
		await plan.save();
		if (plan.stripeProductId) {
			await this.stripeService.updateProduct(plan.stripeProductId, {
				active: false,
			});
		}

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

	async grantSubscriptionByEmail(
		adminUserId: string,
		dto: ManualGrantDto
	) {
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

		const now = new Date();
		const currentSubscription = await this.userSubscriptionModel.findOne({
			user: user._id,
			status: { $in: ['active', 'trialing'] },
		});

		const nextStatus =
			dto.grantType === ManualGrantType.Trial7Days ? 'trialing' : 'active';
		const nextEndDate =
			dto.grantType === ManualGrantType.Trial7Days
				? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
				: new Date('2099-12-31T23:59:59.999Z');

		const payload = {
			plan: new Types.ObjectId(dto.planId),
			status: nextStatus,
			currentPeriodStart: now,
			currentPeriodEnd: nextEndDate,
			cancelAtPeriodEnd: false,
			trialStart:
				dto.grantType === ManualGrantType.Trial7Days ? now : undefined,
			trialEnd:
				dto.grantType === ManualGrantType.Trial7Days ? nextEndDate : undefined,
			endedAt: undefined,
			canceledAt: undefined,
			quantity: 1,
		};

		let subscriptionRecord: UserSubscription;
		if (currentSubscription) {
			Object.assign(currentSubscription, payload);
			subscriptionRecord = await currentSubscription.save();
		} else {
			subscriptionRecord = await this.userSubscriptionModel.create({
				user: user._id,
				...payload,
			});
		}

		await this.manualGrantAuditModel.create({
			user: user._id,
			userEmail: user.email,
			plan: plan._id,
			grantType: dto.grantType,
			performedBy: adminUser._id,
			performedByEmail: adminUser.email,
			notes: dto.notes?.trim() || undefined,
		});

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

	async getOverview(): Promise<AdminOverviewResponse> {
		const [activeCount, trialCount, manualGrantCount, planUsageRaw] =
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
								$ifNull: [{ $arrayElemAt: ['$plan.name', 0] }, 'Plano removido'],
							},
						},
					},
					{ $sort: { count: -1, planName: 1 } },
				]),
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
		};
	}
}
