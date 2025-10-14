import { IsString, IsOptional, IsNumber, IsDateString } from 'class-validator';

export class PaymentUserSubscriptionDto {
	@IsString()
	userId: string;

	@IsString()
	subscriptionId: string;

	@IsOptional()
	@IsString()
	providerCustomerId?: string;

	@IsOptional()
	@IsNumber()
	trialDays?: number;

	@IsOptional()
	@IsNumber()
	quantity?: number;

	@IsOptional()
	@IsDateString()
	startDate?: string;

	@IsOptional()
	@IsDateString()
	endDate?: string;
}
