import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
	IsBoolean,
	IsIn,
	IsInt,
	IsObject,
	IsOptional,
	IsString,
	Matches,
	Max,
	MaxLength,
	Min,
	MinLength,
} from 'class-validator';

const TOTP = /^\d{6}$/;

/**
 * Mudança de um agente (ADR-005, seção 9). `config` chega como objeto livre
 * aqui e é validado pelo esquema estrito do próprio agente no serviço: o DTO
 * não conhece os campos de cada um.
 */
export class UpdateAgentControlDto {
	@ApiPropertyOptional()
	@IsOptional()
	@IsBoolean()
	enabled?: boolean;

	@ApiPropertyOptional({ enum: ['two_hours', 'none'] })
	@IsOptional()
	@IsIn(['two_hours', 'none'])
	pause?: 'two_hours' | 'none';

	@ApiPropertyOptional({ type: Object })
	@IsOptional()
	@IsObject()
	config?: Record<string, unknown>;

	@ApiPropertyOptional({
		description: 'Obrigatório para desligar, pausar e configurar.',
	})
	@IsOptional()
	@IsString()
	@MaxLength(300)
	reason?: string;

	@ApiProperty({
		description: 'Versão que o painel leu; 409 se outra mudança chegou antes.',
	})
	@Type(() => Number)
	@IsInt()
	@Min(1)
	version: number;

	@ApiProperty({ description: 'Código atual do autenticador (2FA).' })
	@IsString()
	@Matches(TOTP, { message: 'totp precisa ter 6 dígitos.' })
	totp: string;
}

export class PauseAllAiAgentsDto {
	@ApiProperty()
	@IsString()
	@MinLength(10)
	@MaxLength(300)
	reason: string;

	@ApiProperty({ description: 'Código atual do autenticador (2FA).' })
	@IsString()
	@Matches(TOTP, { message: 'totp precisa ter 6 dígitos.' })
	totp: string;
}

export class ListAgentChangesQueryDto {
	@ApiPropertyOptional({ default: 50, maximum: 200 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(200)
	limit?: number;
}
