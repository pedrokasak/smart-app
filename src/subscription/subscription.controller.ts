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

@Controller('subscription')
@ApiTags('subscription')
@ApiBearerAuth('access-token')
export class SubscriptionController {
	constructor(private readonly subscriptionService: SubscriptionService) {}

	@Get('current')
	async getCurrentSubscription(@Req() req: any) {
		const subscription =
			await this.subscriptionService.findCurrentSubscriptionByUser(
				req.user.userId
			);

		return {
			hasSubscription: !!subscription,
			subscription,
			plan: subscription?.plan,
		};
	}

	@Public()
	@Get()
	@ApiOperation({ summary: 'Listar todos os planos' })
	findAll() {
		return this.subscriptionService.findAllSubscriptions();
	}

	@Get(':id')
	@ApiOperation({ summary: 'Buscar plano por ID' })
	@ApiResponse({ status: 200, description: 'Plano encontrado' })
	@ApiResponse({ status: 404, description: 'Plano não encontrado' })
	findOne(@Param('id') id: string) {
		return this.subscriptionService.findSubscriptionById(id);
	}

	@Post(':subscriptionId/checkout')
	createCheckout(
		@Param('subscriptionId') subscriptionId: string,
		@Body() body: CreateCheckoutDto
	) {
		return this.subscriptionService.createCheckoutSession(
			body.userId,
			subscriptionId,
			body.successUrl,
			body.cancelUrl,
			body.billingInterval
		);
	}

	@Post('portal')
	createPortalSession(@Body() body: { userId: string; returnUrl: string }) {
		return this.subscriptionService.createPortalSession(
			body.userId,
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
	async cancelSubscription(@Body() body: { userId: string }) {
		return this.subscriptionService.cancelUserSubscription(body.userId);
	}

	@Delete('delete/:id')
	@UseGuards(RolesGuard)
	@Roles(Role.Admin)
	remove(@Param('id') id: string) {
		return this.subscriptionService.removeSubscription(id);
	}
}
