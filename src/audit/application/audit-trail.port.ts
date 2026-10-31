import { AuditEventInput } from 'src/audit/domain/audit-event';

/**
 * Única dependência de quem produz evento de auditoria (ADR-004, 9.3). O
 * domínio não importa driver: grava o evento pela porta e segue. O request
 * só faz um insert; quem numera e encadeia é o selador, fora do caminho
 * crítico.
 */
export interface AuditTrail {
	/** Insere o evento como pendente. Lança se não conseguir gravar. */
	record(event: AuditEventInput): Promise<void>;
}

export const AUDIT_TRAIL = Symbol('AUDIT_TRAIL');
