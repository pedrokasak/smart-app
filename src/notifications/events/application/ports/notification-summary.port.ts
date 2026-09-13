import { ThresholdEvidenceItem } from 'src/thresholds/domain/threshold.types';
import { NotificationType } from '../../domain/notification.types';

/**
 * Pedido de resumo em linguagem natural (TRA-136, fase 5).
 *
 * `evidence` e a UNICA fonte de numeros autorizada. TRA-55 e TRA-56 ja
 * trataram figura alucinada: o lado do trackerr-ia rejeita numero que nao
 * esteja na evidencia, e o lado de ca so manda numero que saiu do calculo
 * que decidiu notificar.
 */
export interface NotificationSummaryRequest {
	userId: string;
	notificationType: NotificationType;
	ruleId: string | null;
	scope: string;
	/** Copy deterministica ja montada por `buildTemplate`. Serve de ancora. */
	deterministicTitle: string;
	deterministicBody: string;
	evidence: ThresholdEvidenceItem[];
}

/**
 * Falha transitoria (timeout, rede, 5xx). O chamador propaga para que o
 * BullMQ tente de novo — a notificacao determinista JA SAIU antes desta
 * chamada, entao o retry so busca o enriquecimento.
 */
export class TransientSummaryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TransientSummaryError';
	}
}

export interface NotificationSummaryProvider {
	/** `null` quando nao ha resumo utilizavel. Nunca inventa texto. */
	summarize(request: NotificationSummaryRequest): Promise<string | null>;
}

export const NOTIFICATION_SUMMARY_PROVIDER = Symbol(
	'NOTIFICATION_SUMMARY_PROVIDER'
);
