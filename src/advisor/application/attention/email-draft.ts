import { Alert } from '../../domain/attention.entities';
import { AlertRule, AssetClass } from '../../domain/enums';

export interface EmailDraftText {
	subject: string;
	body: string;
}

const SUBJECT = 'Acompanhamento da sua carteira';

const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
	[AssetClass.Stock]: 'Ações',
	[AssetClass.Fii]: 'Fundos imobiliários',
	[AssetClass.Etf]: 'ETFs',
	[AssetClass.Crypto]: 'Criptoativos',
	[AssetClass.Fund]: 'Fundos',
	[AssetClass.FixedIncome]: 'Renda fixa',
	[AssetClass.Other]: 'Outros',
};

const num = (value: unknown): string | null =>
	typeof value === 'number' && Number.isFinite(value)
		? String(Math.round(value * 100) / 100).replace('.', ',')
		: null;

const text = (value: unknown): string | null =>
	typeof value === 'string' && value.length > 0 ? value : null;

/** `YYYY-MM-DD` -> `DD/MM/YYYY`; outra forma fica de fora. */
const brDate = (iso: string): string | null => {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
};

const asOf = (alert: Alert): string => {
	const date = brDate(alert.dataAsOf);
	return date ? ` (dados de ${date})` : '';
};

/**
 * A frase do fato, a partir dos `params` do alerta. Só fatos da carteira e
 * nunca uma sugestão de operação (B4). Sem o parâmetro, cai na frase geral.
 */
function factOf(alert: Alert): string | null {
	const p = alert.params;
	switch (alert.rule) {
		case AlertRule.PositionDrop: {
			const symbol = text(p.symbol);
			const pct = num(p.dropPct);
			if (!symbol || !pct) return null;
			return `Notei que ${symbol} caiu ${pct}% na última semana (5 pregões)${asOf(alert)}.`;
		}
		case AlertRule.PortfolioDrawdown: {
			const pct = num(p.drawdownPct);
			if (!pct) return null;
			return `Notei que a sua carteira está ${pct}% abaixo do maior valor dos últimos 12 meses${asOf(alert)}.`;
		}
		case AlertRule.Concentration: {
			const symbol = text(p.symbol);
			const pct = num(p.weightPct);
			if (!symbol || !pct) return null;
			return `Notei que ${symbol} representa ${pct}% da sua carteira${asOf(alert)}.`;
		}
		case AlertRule.TargetDrift: {
			const cls = text(p.assetClass);
			const drift = typeof p.driftPp === 'number' ? p.driftPp : null;
			const pp = num(drift === null ? null : Math.abs(drift));
			const label = cls ? ASSET_CLASS_LABEL[cls as AssetClass] : undefined;
			if (!label || drift === null || !pp) return null;
			const side = drift > 0 ? 'acima' : 'abaixo';
			return `Notei que a parcela de ${label} na sua carteira está ${pp} pontos percentuais ${side} da meta de alocação que combinamos${asOf(alert)}.`;
		}
		case AlertRule.LargeSells: {
			const pct = num(p.windowPct);
			if (!pct) return null;
			return `Notei que as saídas registradas na sua carteira nos últimos 30 dias somaram ${pct}% do patrimônio${asOf(alert)}.`;
		}
		case AlertRule.NoContact: {
			const days = num(p.days);
			if (!days) return null;
			return `Faz ${days} dias desde a nossa última conversa sobre a sua carteira.`;
		}
		default:
			// MANUAL: título e nota são do escritório e não vão para o cliente.
			return null;
	}
}

/**
 * Rascunho em pt-BR para o assessor abrir no próprio cliente de e-mail (B3).
 * O Trackerr não envia nem guarda o texto.
 */
export function renderEmailDraft(alert: Alert): EmailDraftText {
	const fact = factOf(alert);
	const lines = [
		'Olá,',
		'',
		fact ?? 'Gostaria de conversar com você sobre a sua carteira.',
		'',
		'Podemos marcar um horário para conversar?',
		'',
		'Abraço,',
	];
	return { subject: SUBJECT, body: lines.join('\n') };
}
