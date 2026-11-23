import type { ClientPortfolioMetrics } from '../application/metrics/build-portfolio-metrics';
import {
	AlertHandledVia,
	AlertPriority,
	AlertRule,
	AlertStatus,
	PortfolioProvenance,
	SnapshotSource,
} from './enums';

export interface AlertCandidate {
	rule: AlertRule;
	/** `null` nas regras que não pertencem a uma fonte (`NO_CONTACT`). */
	source: SnapshotSource | null;
	/**
	 * Só na carteira compartilhada do B2C: cada carteira é uma fonte própria
	 * e entra na impressão digital.
	 */
	portfolioId?: string;
	/** Símbolo, classe, `portfolio`, `client` ou, em `MANUAL`, o id do alerta. */
	key: string;
	/** 1 = faixa menos grave, 2 = mais grave. */
	band: 1 | 2;
	priority: AlertPriority;
	messageKey: string;
	params: Record<string, string | number>;
	evidence: Record<string, string | number | null>;
	dataAsOf: string;
	provenance: PortfolioProvenance | null;
	lowConfidence: boolean;
}

export interface Alert extends AlertCandidate {
	id: string;
	orgId: string;
	clientProfileId: string;
	/** `${rule}:${source ?? '-'}[/portfolioId]:${key}`. */
	conditionKey: string;
	status: AlertStatus;
	createdAt: Date;
	updatedAt: Date;
	createdByUserId?: string;
	title?: string;
	note?: string;
	dueDate?: string;
	snoozedUntil?: string;
	handledVia?: AlertHandledVia;
	handledByUserId?: string;
	dismissReason?: string;
	closedAt?: Date;
}

export interface SourceSnapshot {
	source: SnapshotSource;
	portfolioId?: string;
	metrics: ClientPortfolioMetrics | null;
	unavailableReason?: string;
}

export interface ClientSnapshot {
	orgId: string;
	clientProfileId: string;
	asOf: string;
	sources: SourceSnapshot[];
	totalMinor: number;
	verifiedMinor: number;
	manualMinor: number;
	relationshipStartedAt: Date;
	lastContactAt: Date | null;
	computedAt: Date;
}

/** Vendas dos últimos 30 dias no livro do assessor. */
export interface SellWindow {
	sellsMinor30d: number;
}

export const conditionKeyOf = (
	c: Pick<AlertCandidate, 'rule' | 'source' | 'key' | 'portfolioId'>
): string =>
	`${c.rule}:${c.source ?? '-'}${c.portfolioId ? `/${c.portfolioId}` : ''}:${c.key}`;

/** Motivos de indisponibilidade de uma fonte, gravados no snapshot. */
export const SOURCE_METRICS_FAILED = 'METRICS_FAILED';
export const SOURCE_READ_FAILED = 'SOURCE_READ_FAILED';
