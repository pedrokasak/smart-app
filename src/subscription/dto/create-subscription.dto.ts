import {
	IsString,
	IsNumber,
	IsOptional,
	IsBoolean,
	IsArray,
	IsEnum,
	IsIn,
	IsInt,
	Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ALL_PLAN_CAPABILITIES } from 'src/subscription/application/user-plan.types';

export class CreateSubscriptionDto {
	@ApiProperty({ description: 'Nome da assinatura' })
	@IsString()
	name: string;

	@ApiPropertyOptional({ description: 'Descrição da assinatura' })
	@IsOptional()
	@IsString()
	description?: string;

	@ApiProperty({ description: 'Preço da assinatura' })
	@IsNumber()
	price: number;

	@ApiPropertyOptional({ description: 'Moeda (padrão: BRL)', default: 'BRL' })
	@IsOptional()
	@IsString()
	currency?: string;

	@ApiProperty({
		description: 'Intervalo de cobrança',
		enum: ['month', 'year', 'week', 'day'],
	})
	@IsEnum(['month', 'year', 'week', 'day'])
	interval: 'month' | 'year' | 'week' | 'day';

	@ApiPropertyOptional({ description: 'Quantidade de intervalos', default: 1 })
	@IsOptional()
	@IsNumber()
	intervalCount?: number;

	@ApiPropertyOptional({
		description:
			'Nível de acesso liberado pelo plano — qualquer inteiro >= 0, sem lista fixa. ' +
			'Renomear o plano não muda o acesso; dois planos podem ter o mesmo nível.',
		minimum: 0,
	})
	@IsOptional()
	@IsInt()
	@Min(0)
	accessLevel?: number;

	@ApiPropertyOptional({ description: 'ID do preço no Stripe' })
	@IsOptional()
	@IsString()
	stripePriceId?: string;

	@ApiPropertyOptional({ description: 'ID do produto no Stripe' })
	@IsOptional()
	@IsString()
	stripeProductId?: string;

	@ApiPropertyOptional({ description: 'Preço anual da assinatura' })
	@IsOptional()
	@IsNumber()
	annualPrice?: number;

	@ApiPropertyOptional({ description: 'ID do preço anual no Stripe' })
	@IsOptional()
	@IsString()
	annualStripePriceId?: string;

	@ApiPropertyOptional({
		description: 'Se a assinatura está ativa',
		default: true,
	})
	@IsOptional()
	@IsBoolean()
	isActive?: boolean;

	@ApiPropertyOptional({
		description: 'Se o plano deve ser destacado na landing',
		default: false,
	})
	@IsOptional()
	@IsBoolean()
	isFeatured?: boolean;

	@ApiPropertyOptional({
		description: 'Se o plano deve ser exibido como "em breve"',
		default: false,
	})
	@IsOptional()
	@IsBoolean()
	isComingSoon?: boolean;

	@ApiPropertyOptional({ description: 'Lista de recursos incluídos' })
	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	features?: string[];

	@ApiPropertyOptional({
		description:
			'Capability keys que este plano libera (TRA-189) — separadas do ' +
			'texto de vitrine em `features`.',
		enum: ALL_PLAN_CAPABILITIES,
		isArray: true,
	})
	@IsOptional()
	@IsArray()
	@IsIn(ALL_PLAN_CAPABILITIES, { each: true })
	capabilities?: string[];

	@ApiPropertyOptional({ description: 'Número máximo de usuários permitidos' })
	@IsOptional()
	@IsNumber()
	maxUsers?: number;
}
