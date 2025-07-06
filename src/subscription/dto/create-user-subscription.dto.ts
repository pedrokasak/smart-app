import {
	IsString,
	IsNumber,
	IsOptional,
	IsBoolean,
	IsDateString,
	IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserSubscriptionDto {
	@ApiProperty({ description: 'ID do usuário' })
	@IsString()
	userId: string;

	@ApiProperty({ description: 'ID da assinatura' })
	@IsString()
	subscriptionId: string;

	@ApiPropertyOptional({ description: 'ID da assinatura no Stripe' })
	@IsOptional()
	@IsString()
	stripeSubscriptionId?: string;

	@ApiPropertyOptional({ description: 'ID do cliente no Stripe' })
	@IsOptional()
	@IsString()
	stripeCustomerId?: string;

	@ApiPropertyOptional({
		description: 'Status da assinatura',
		enum: ['active', 'canceled', 'past_due', 'unpaid', 'trialing', 'paused'],
		default: 'active',
	})
	@IsOptional()
	@IsEnum(['active', 'canceled', 'past_due', 'unpaid', 'trialing', 'paused'])
	status?:
		| 'active'
		| 'canceled'
		| 'past_due'
		| 'unpaid'
		| 'trialing'
		| 'paused';

	@ApiProperty({ description: 'Início do período atual' })
	@IsDateString()
	currentPeriodStart: string;

	@ApiProperty({ description: 'Fim do período atual' })
	@IsDateString()
	currentPeriodEnd: string;

	@ApiPropertyOptional({
		description: 'Cancelar no fim do período',
		default: false,
	})
	@IsOptional()
	@IsBoolean()
	cancelAtPeriodEnd?: boolean;

	@ApiPropertyOptional({ description: 'Data de cancelamento' })
	@IsOptional()
	@IsDateString()
	canceledAt?: string;

	@ApiPropertyOptional({ description: 'Data de término' })
	@IsOptional()
	@IsDateString()
	endedAt?: string;

	@ApiPropertyOptional({ description: 'Início do período de teste' })
	@IsOptional()
	@IsDateString()
	trialStart?: string;

	@ApiPropertyOptional({ description: 'Fim do período de teste' })
	@IsOptional()
	@IsDateString()
	trialEnd?: string;

	@ApiPropertyOptional({ description: 'Quantidade', default: 1 })
	@IsOptional()
	@IsNumber()
	quantity?: number;
}
