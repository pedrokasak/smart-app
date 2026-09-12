import { DomainEvent } from './domain-event';

/**
 * Guarda de contrato do envelope.
 *
 * Necessaria porque o evento atravessa uma fronteira de serializacao: sai
 * como JSON para o Redis e volta como `unknown`. Quando o transporte deixar
 * de ser in-process, o que chega vem de outro processo — possivelmente de
 * outra versao do servico. Validar na borda mantem o dominio limpo.
 */
export type EnvelopeViolation = string;

const ISO_8601 =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateDomainEvent(value: unknown): EnvelopeViolation[] {
	const violations: EnvelopeViolation[] = [];

	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return ['envelope precisa ser um objeto'];
	}

	const event = value as Record<string, unknown>;

	if (typeof event.id !== 'string' || !UUID.test(event.id)) {
		violations.push('id precisa ser um UUID gerado pelo produtor');
	}
	if (typeof event.type !== 'string' || event.type.length === 0) {
		violations.push('type precisa ser uma string nao vazia');
	}
	if (
		typeof event.version !== 'number' ||
		!Number.isInteger(event.version) ||
		event.version < 1
	) {
		violations.push('version precisa ser um inteiro >= 1');
	}
	if (
		typeof event.occurredAt !== 'string' ||
		!ISO_8601.test(event.occurredAt)
	) {
		violations.push('occurredAt precisa ser ISO-8601 com timezone');
	}
	if (typeof event.producer !== 'string' || event.producer.length === 0) {
		violations.push('producer precisa ser uma string nao vazia');
	}
	if (typeof event.subject !== 'string' || event.subject.length === 0) {
		violations.push('subject precisa ser uma string nao vazia');
	}
	if (
		event.correlationId !== undefined &&
		typeof event.correlationId !== 'string'
	) {
		violations.push('correlationId, quando presente, precisa ser string');
	}
	if (
		event.causationId !== undefined &&
		typeof event.causationId !== 'string'
	) {
		violations.push('causationId, quando presente, precisa ser string');
	}
	if (!('payload' in event)) {
		violations.push('payload e obrigatorio');
	}

	return violations;
}

export function isDomainEvent(value: unknown): value is DomainEvent {
	return validateDomainEvent(value).length === 0;
}

export class InvalidDomainEventError extends Error {
	constructor(readonly violations: EnvelopeViolation[]) {
		super(`Envelope de evento invalido: ${violations.join('; ')}`);
		this.name = 'InvalidDomainEventError';
	}
}

export function assertDomainEvent(
	value: unknown
): asserts value is DomainEvent {
	const violations = validateDomainEvent(value);
	if (violations.length > 0) {
		throw new InvalidDomainEventError(violations);
	}
}
