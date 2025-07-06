import {
	IsString,
	IsNumber,
	IsOptional,
	IsBoolean,
	IsArray,
	IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

	@ApiPropertyOptional({ description: 'ID do preço no Stripe' })
	@IsOptional()
	@IsString()
	stripePriceId?: string;

	@ApiPropertyOptional({ description: 'ID do produto no Stripe' })
	@IsOptional()
	@IsString()
	stripeProductId?: string;

	@ApiPropertyOptional({
		description: 'Se a assinatura está ativa',
		default: true,
	})
	@IsOptional()
	@IsBoolean()
	isActive?: boolean;

	@ApiPropertyOptional({ description: 'Lista de recursos incluídos' })
	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	features?: string[];

	@ApiPropertyOptional({ description: 'Número máximo de usuários permitidos' })
	@IsOptional()
	@IsNumber()
	maxUsers?: number;
}
