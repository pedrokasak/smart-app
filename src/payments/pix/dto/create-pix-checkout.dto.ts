import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
	IsIn,
	IsMongoId,
	IsOptional,
	IsString,
	MaxLength,
} from 'class-validator';
import {
	PIX_INTERVALS,
	PixInterval,
} from 'src/payments/pix/domain/pix-billing';

export class CreatePixCheckoutDto {
	@ApiProperty({ description: 'Id do plano (catálogo do admin).' })
	@IsMongoId()
	planId: string;

	@ApiProperty({ enum: PIX_INTERVALS })
	@IsIn(PIX_INTERVALS)
	interval: PixInterval;

	/**
	 * Obrigatório só na primeira compra por PIX (o provedor exige CPF para
	 * emitir cobrança). Validado pelos dígitos verificadores no service.
	 */
	@ApiPropertyOptional({ example: '123.456.789-09' })
	@IsOptional()
	@IsString()
	@MaxLength(14)
	cpf?: string;
}
