import {
	Controller,
	Get,
	Post,
	Body,
	Patch,
	Param,
	Delete,
	Req,
	UseGuards,
	ForbiddenException,
	Inject,
} from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { UpdateFeaturesDto } from './dto/update-features.dto';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import {
	ApiBearerAuth,
	ApiOperation,
	ApiResponse,
	ApiTags,
} from '@nestjs/swagger';
import { Public } from 'src/utils/constants';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Role } from 'src/auth/enums/role.enum';
import {
	USER_PLAN_RESOLVER,
	UserPlanResolverPort,
	effectiveCapabilities,
} from './application/user-plan.types';

import {
	NotUserScoped,
	OwnershipChecked,
} from 'src/auth/decorators/ownership.decorator';
/**
 * Rotas de conta usam SEMPRE o usuário do token. O `userId` que o web ainda
 * envia no corpo é ignorado: aceitá-lo deixava qualquer sessão abrir o portal
 * de cobrança, criar checkout ou cancelar a assinatura de outra pessoa.
 */
function requireUserId(req: any): string {
	const userId = req.user?.userId ?? req.user?.sub;
	if (!userId) throw new ForbiddenException('Usuário não autenticado.');
	return String(userId);
}

@Controller('subscription')
@ApiTags('subscription')
@ApiBearerAuth('access-token')
export class SubscriptionController {
	constructor(
		private readonly subscriptionService: SubscriptionService,
		@Inject(USER_PLAN_RESOLVER)
		private readonly planResolver: UserPlanResolverPort
	) {}

	@Get('current')
	async getCurrentSubscription(@Req() req: any) {
		const userId = requireUserId(req);
		const [subscription, access] = await Promise.all([
			this.subscriptionService.findCurrentSubscriptionByUser(userId),
			this.planResolver.resolveWithCapabilities(userId),
		]);

		return {
			hasSubscription: !!subscription,
			subscription,
			plan: subscription?.plan,
			// Mesma regra do PlanCapabilityGuard: o web lê daqui em vez de
			// adivinhar por nome/nível de plano (TRA-200).
			capabilities: effectiveCapabilities(access),
		};
	}

	@Get('invoices')
	@ApiOperation({ summary: 'Faturas do usuário autenticado (Stripe)' })
	listInvoices(@Req() req: any) {
		return this.subscriptionService.listUserInvoices(requireUserId(req));
	}

	@Public()
	@Get()
	@ApiOperation({ summary: 'Listar todos os planos' })
	findAll() {
		return this.subscriptionService.findAllSubscriptions();
	}

	@NotUserScoped('catálogo público de planos')
	@Get(':id')
	@ApiOperation({ summary: 'Buscar plano por ID' })
	@ApiResponse({ status: 200, description: 'Plano encontrado' })
	@ApiResponse({ status: 404, description: 'Plano não encontrado' })
	findOne(@Param('id') id: string) {
		return this.subscriptionService.findSubscriptionById(id);
	}

	@OwnershipChecked('checkout para o usuário do token; o id é do plano')
	@Post(':subscriptionId/checkout')
	createCheckout(
		@Param('subscriptionId') subscriptionId: string,
		@Body() body: CreateCheckoutDto,
		@Req() req: any
	) {
		return this.subscriptionService.createCheckoutSession(
			requireUserId(req),
			subscriptionId,
			body.successUrl,
			body.cancelUrl,
			body.billingInterval
		);
	}

	@Post('portal')
	createPortalSession(@Body() body: { returnUrl: string }, @Req() req: any) {
		return this.subscriptionService.createPortalSession(
			requireUserId(req),
			body.returnUrl
		);
	}

	@Post('create')
	@UseGuards(RolesGuard)
	@Roles(Role.Admin)
	create(@Body() createSubscriptionDto: CreateSubscriptionDto) {
		return this.subscriptionService.createSubscription(createSubscriptionDto);
	}

	@Patch(':id')
	@UseGuards(RolesGuard)
	@Roles(Role.Admin)
	update(
		@Param('id') id: string,
		@Body() updateSubscriptionDto: UpdateSubscriptionDto
	) {
		return this.subscriptionService.updateSubscription(
			id,
			updateSubscriptionDto
		);
	}

	@Patch(':id/features')
	@UseGuards(RolesGuard)
	@Roles(Role.Admin)
	updateFeatures(
		@Param('id') id: string,
		@Body() updateFeaturesDto: UpdateFeaturesDto
	) {
		return this.subscriptionService.updateSubscriptionFeatures(
			id,
			updateFeaturesDto
		);
	}

	@Post('cancel')
	async cancelSubscription(@Req() req: any) {
		return this.subscriptionService.cancelUserSubscription(requireUserId(req));
	}

	@Delete('delete/:id')
	@UseGuards(RolesGuard)
	@Roles(Role.Admin)
	remove(@Param('id') id: string) {
		return this.subscriptionService.removeSubscription(id);
	}
}
