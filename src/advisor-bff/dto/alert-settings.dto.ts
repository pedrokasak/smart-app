import {
	ApiProperty,
	ApiPropertyOptional,
	type ApiPropertyOptions,
} from '@nestjs/swagger';
import {
	ArrayMaxSize,
	ArrayMinSize,
	IsArray,
	IsInt,
	IsNumber,
	IsOptional,
	Max,
	Min,
} from 'class-validator';
import type { AlertSettingsView } from 'src/advisor/application/attention/alert-settings.service';
import {
	ALERT_SETTINGS_RANGES,
	AlertSettings,
} from 'src/advisor/domain/alert-settings';

const R = ALERT_SETTINGS_RANGES;

/** As faixas vêm do domínio; a ordem (grave > leve) é conferida no serviço. */
const bandsDoc = (
	field: keyof typeof R,
	lighter: string,
	severe: string
): ApiPropertyOptions => ({
	type: 'array',
	items: { type: 'number' },
	minItems: 2,
	maxItems: 2,
	description: `[${lighter}, ${severe}], cada um de ${R[field].min} a ${R[field].max}; ${severe} > ${lighter}. Omitido volta ao padrão`,
});

/**
 * `PUT` grava o conjunto inteiro: campo omitido volta ao padrão. Fora da
 * faixa ou do formato: 400 VALIDATION_FAILED; fora de ordem: 400
 * VALIDATION_FAILED com `details.field`.
 */
export class PutAlertSettingsDto {
	@ApiPropertyOptional(bandsDoc('noContactDays', 'P3', 'P2'))
	@IsOptional()
	@IsArray()
	@ArrayMinSize(2)
	@ArrayMaxSize(2)
	@IsInt({ each: true })
	@Min(R.noContactDays.min, { each: true })
	@Max(R.noContactDays.max, { each: true })
	noContactDays?: [number, number];

	@ApiPropertyOptional(bandsDoc('positionDropPct', 'P1', 'P0'))
	@IsOptional()
	@IsArray()
	@ArrayMinSize(2)
	@ArrayMaxSize(2)
	@IsNumber({ allowNaN: false, allowInfinity: false }, { each: true })
	@Min(R.positionDropPct.min, { each: true })
	@Max(R.positionDropPct.max, { each: true })
	positionDropPct?: [number, number];

	@ApiPropertyOptional(bandsDoc('portfolioDrawdownPct', 'P2', 'P1'))
	@IsOptional()
	@IsArray()
	@ArrayMinSize(2)
	@ArrayMaxSize(2)
	@IsNumber({ allowNaN: false, allowInfinity: false }, { each: true })
	@Min(R.portfolioDrawdownPct.min, { each: true })
	@Max(R.portfolioDrawdownPct.max, { each: true })
	portfolioDrawdownPct?: [number, number];

	@ApiPropertyOptional(bandsDoc('concentrationPct', 'P2', 'P1'))
	@IsOptional()
	@IsArray()
	@ArrayMinSize(2)
	@ArrayMaxSize(2)
	@IsNumber({ allowNaN: false, allowInfinity: false }, { each: true })
	@Min(R.concentrationPct.min, { each: true })
	@Max(R.concentrationPct.max, { each: true })
	concentrationPct?: [number, number];

	@ApiPropertyOptional(bandsDoc('targetDriftPp', 'P3', 'P2'))
	@IsOptional()
	@IsArray()
	@ArrayMinSize(2)
	@ArrayMaxSize(2)
	@IsNumber({ allowNaN: false, allowInfinity: false }, { each: true })
	@Min(R.targetDriftPp.min, { each: true })
	@Max(R.targetDriftPp.max, { each: true })
	targetDriftPp?: [number, number];

	@ApiPropertyOptional({
		minimum: R.largeSellsPct.min,
		maximum: R.largeSellsPct.max,
		description: 'P1, em % do patrimônio (30 dias). Omitido volta ao padrão',
	})
	@IsOptional()
	@IsNumber({ allowNaN: false, allowInfinity: false })
	@Min(R.largeSellsPct.min)
	@Max(R.largeSellsPct.max)
	largeSellsPct?: number;
}

export class AlertSettingsResponseDto {
	@ApiProperty({ type: [Number], description: '[P3, P2] em dias' })
	noContactDays: [number, number];

	@ApiProperty({ type: [Number], description: '[P1, P0] em %, 5 pregões' })
	positionDropPct: [number, number];

	@ApiProperty({ type: [Number], description: '[P2, P1] em %' })
	portfolioDrawdownPct: [number, number];

	@ApiProperty({ type: [Number], description: '[P2, P1] em % da carteira' })
	concentrationPct: [number, number];

	@ApiProperty({
		type: [Number],
		description: '[P3, P2] em pontos percentuais',
	})
	targetDriftPp: [number, number];

	@ApiProperty({ description: 'P1, em % do patrimônio, 30 dias' })
	largeSellsPct: number;

	@ApiProperty({
		type: String,
		format: 'date-time',
		nullable: true,
		description: 'Quando o motor foi ligado na organização; nulo antes disso',
	})
	engineEnabledAt: Date | null;

	static of(view: AlertSettingsView): AlertSettingsResponseDto {
		const s: AlertSettings = view.settings;
		return {
			noContactDays: [...s.noContactDays],
			positionDropPct: [...s.positionDropPct],
			portfolioDrawdownPct: [...s.portfolioDrawdownPct],
			concentrationPct: [...s.concentrationPct],
			targetDriftPp: [...s.targetDriftPp],
			largeSellsPct: s.largeSellsPct,
			engineEnabledAt: view.engineEnabledAt,
		};
	}
}
