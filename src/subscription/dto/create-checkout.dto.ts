import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCheckoutDto {
	/** Ignorado: o checkout é sempre do usuário do token. Mantido por compatibilidade. */
	@ApiPropertyOptional({ deprecated: true })
	@IsOptional()
	@IsString()
	userId?: string;

	@ApiProperty({ description: 'URL de redirecionamento em caso de sucesso' })
	@IsString()
	@IsNotEmpty()
	successUrl: string;

	@ApiProperty({
		description: 'URL de redirecionamento em caso de cancelamento',
	})
	@IsString()
	@IsNotEmpty()
	cancelUrl: string;

	@ApiPropertyOptional({
		description: 'Intervalo de cobrança escolhido (padrão: mensal)',
		enum: ['monthly', 'annual'],
	})
	@IsOptional()
	@IsIn(['monthly', 'annual'])
	billingInterval?: 'monthly' | 'annual';
}
