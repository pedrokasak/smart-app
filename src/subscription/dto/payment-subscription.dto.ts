import { IsString, IsNumber, IsOptional, IsEnum } from 'class-validator';

export enum Interval {
	DAY = 'day',
	WEEK = 'week',
	MONTH = 'month',
	YEAR = 'year',
}

export class PaymentSubscriptionDto {
	@IsString()
	name: string;

	@IsOptional()
	@IsString()
	description?: string;

	@IsNumber()
	price: number;

	@IsOptional()
	@IsString()
	currency?: string; // ex: 'brl', 'usd'

	@IsOptional()
	@IsEnum(Interval)
	interval?: Interval; // frequência da cobrança

	@IsOptional()
	@IsNumber()
	intervalCount?: number; // número de intervalos entre cobranças

	@IsOptional()
	@IsString()
	productId?: string; // id do produto no provedor (Stripe, Asaas)

	@IsOptional()
	@IsString()
	priceId?: string; // id do preço no provedor

	@IsOptional()
	@IsNumber()
	trialDays?: number; // dias de teste
}
