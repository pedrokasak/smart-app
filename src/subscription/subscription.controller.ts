import {
	Controller,
	Get,
	Post,
	Body,
	Patch,
	Param,
	Delete,
} from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { UpdateFeaturesDto } from './dto/update-features.dto';

@Controller('subscription')
export class SubscriptionController {
	constructor(private readonly subscriptionService: SubscriptionService) {}

	@Post(':id/checkout')
	createCheckout(
		@Param('id') id: string,
		@Body() body: { userId: string; successUrl: string; cancelUrl: string }
	) {
		return this.subscriptionService.createCheckoutSession(
			body.userId,
			id,
			body.successUrl,
			body.cancelUrl
		);
	}

	@Post('create')
	create(@Body() createSubscriptionDto: CreateSubscriptionDto) {
		return this.subscriptionService.createSubscription(createSubscriptionDto);
	}

	@Get()
	findAll() {
		return this.subscriptionService.findAllSubscriptions();
	}

	@Get(':id')
	findOne(@Param('id') id: string) {
		return this.subscriptionService.findSubscriptionById(id);
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

	@Delete(':id')
	remove(@Param('id') id: string) {
		return this.subscriptionService.removeSubscription(id);
	}
}
