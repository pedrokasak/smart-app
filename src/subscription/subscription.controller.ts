import {
	Controller,
	Get,
	Post,
	Body,
	Patch,
	Param,
	Delete,
	Req,
} from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { UpdateFeaturesDto } from './dto/update-features.dto';
import {
	ApiBearerAuth,
	ApiOperation,
	ApiResponse,
	ApiTags,
} from '@nestjs/swagger';

@Controller('subscription')
@ApiTags('subscription')
@ApiBearerAuth('access-token')
export class SubscriptionController {
	constructor(private readonly subscriptionService: SubscriptionService) {}

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
		@Body() body: { userId: string; successUrl: string; cancelUrl: string }
	) {
		return this.subscriptionService.createCheckoutSession(
			body.userId,
			subscriptionId,
			body.successUrl,
			body.cancelUrl
		);
	}

	@Post('create')
	create(@Body() createSubscriptionDto: CreateSubscriptionDto) {
		return this.subscriptionService.createSubscription(createSubscriptionDto);
	}

	@Get('current')
	getCurrentSubscription(@Req() req) {
		const userId = req.user.id;
		return this.subscriptionService.findCurrentSubscriptionByUser(userId);
	}

	@Patch(':id')
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
	remove(@Param('id') id: string) {
		return this.subscriptionService.removeSubscription(id);
	}
}
