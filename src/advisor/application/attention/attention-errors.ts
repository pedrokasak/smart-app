import {
	BadRequestException,
	ConflictException,
	NotFoundException,
} from '@nestjs/common';

/**
 * Alerta inexistente, de outra organização ou de cliente fora do alcance do
 * membro: a mesma resposta, para não revelar que o alerta existe.
 */
export class AlertNotFoundError extends NotFoundException {
	readonly reason = 'ALERT_NOT_FOUND' as const;

	constructor() {
		super('Alert not found');
	}
}

/** O alerta já não está OPEN nem SNOOZED (tratado, descartado, resolvido). */
export class AlertNotActiveError extends ConflictException {
	readonly reason = 'ALERT_NOT_ACTIVE' as const;

	constructor() {
		super('Alert is no longer active');
	}
}

/** Entrada inválida numa ação de alerta; `field` diz qual. */
export class InvalidAlertInputError extends BadRequestException {
	readonly reason = 'VALIDATION_FAILED' as const;

	constructor(readonly field: string) {
		super({ reason: 'VALIDATION_FAILED', field });
	}
}

/** Lote com mais de 500 alertas (ids ou filtro). */
export class BulkLimitExceededError extends BadRequestException {
	readonly reason = 'BULK_LIMIT_EXCEEDED' as const;

	constructor(readonly max: number) {
		super({ reason: 'BULK_LIMIT_EXCEEDED', max });
	}
}

/** Limites fora da faixa ou fora de ordem; `field` diz o primeiro. */
export class InvalidAlertSettingsError extends BadRequestException {
	readonly reason = 'VALIDATION_FAILED' as const;

	constructor(readonly field: string) {
		super({ reason: 'VALIDATION_FAILED', field });
	}
}
