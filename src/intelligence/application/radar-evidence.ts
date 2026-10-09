import type { InvestmentPolicy } from 'src/investment-policy/domain/investment-policy';
import type { PortfolioIntelligenceOutput } from 'src/portfolio/intelligence/domain/portfolio-intelligence.types';
import type {
	PortfolioErrorRadarAlert,
	RadarAction,
	RadarEvidence,
} from './portfolio-error-radar.types';

/**
 * Evidência e ação dos alertas do Radar Anti-Erro (Insights IA).
 *
 * O radar dizia "concentração alta" sem o número que importa para a pessoa:
 * o limite que ela mesma definiu na política de investimento. Pior, os
 * limiares do motor (20%/35% por ativo) são bem mais frouxos que a política
 * padrão (8%), então "PETR4 em 11% com limite de 8%" nunca virava alerta.
 * Aqui cada alerta ganha o número, o limite e a fonte; e a política vira
 * alerta próprio quando o motor não disparou.
 *
 * Funções puras: o serviço do radar injeta a política, as posições e a
 * estimativa de IR.
 */

export interface RadarHolding {
	symbol: string;
	assetType: 'stock' | 'fii' | 'crypto' | 'etf' | 'fund' | 'other';
	quantity: number;
	/** Preço unitário usado no valor da posição. */
	price: number;
	/** Custo total (preço médio × quantidade); `null` quando desconhecido. */
	totalCost: number | null;
}

export interface TaxEstimate {
	estimatedTax: number;
	classification: string;
}

export interface EvidenceContext {
	analysis: PortfolioIntelligenceOutput;
	policy: InvestmentPolicy;
	holdings: RadarHolding[];
	/** Descrição da base dos pesos ("valor de mercado de 12 posições…"). */
	basis: string;
	estimateTax: (holding: RadarHolding, quantity: number) => TaxEstimate | null;
}

/** Quantas posições acima do limite da política viram alerta, no máximo. */
export const MAX_POLICY_ASSET_ALERTS = 3;

const TAX_ASSUMPTIONS = [
	'Não considera prejuízo acumulado a compensar.',
	'Não considera outras vendas de ações no mês (isenção de R$ 20 mil).',
];

const CLASS_LABEL: Record<string, string> = {
	equities: 'Ações',
	real_estate: 'FIIs',
	crypto: 'Cripto',
	etf: 'ETFs',
	fund: 'Renda fixa',
	other: 'Outros',
};

export const classLabel = (key: string | undefined) =>
	(key && CLASS_LABEL[key]) || key || 'Uma classe';

/** 10.94 → "10,9": número em português nas mensagens. */
export const formatPctBr = (value: number) =>
	(Math.round(value * 10) / 10).toLocaleString('pt-BR', {
		maximumFractionDigits: 1,
	});

const round = (value: number, digits = 1) =>
	Math.round(value * 10 ** digits) / 10 ** digits;

const fractional = (type: RadarHolding['assetType']) =>
	type === 'crypto' || type === 'fund' || type === 'other';

/**
 * Venda que leva a posição ao limite. A venda também tira o valor da
 * carteira (o caixa não é posição), então a conta é
 * (V − x) / (T − x) = L  ⇒  x = (V − L·T) / (1 − L).
 */
export function reductionToLimit(params: {
	positionValue: number;
	totalValue: number;
	limitPct: number;
	price: number;
	assetType: RadarHolding['assetType'];
}): { quantity: number; amount: number; targetPct: number } | null {
	const { positionValue, totalValue, price, assetType } = params;
	const limit = params.limitPct / 100;
	if (!(price > 0) || !(totalValue > 0) || !(limit > 0) || limit >= 1) {
		return null;
	}
	const amountNeeded = (positionValue - limit * totalValue) / (1 - limit);
	if (!(amountNeeded > 0)) return null;

	const rawQuantity = amountNeeded / price;
	const quantity = fractional(assetType)
		? Math.ceil(rawQuantity * 1e6) / 1e6
		: Math.ceil(rawQuantity);
	const amount = round(quantity * price, 2);
	const targetPct = ((positionValue - amount) / (totalValue - amount)) * 100;
	return { quantity, amount, targetPct: round(targetPct) };
}

function policyLimit(label: string, value: number) {
	return { label, value, unit: 'pct' as const, source: 'policy' as const };
}

function modelLimit(
	label: string,
	value: number,
	unit: 'pct' | 'score' | 'ratio'
) {
	return { label, value, unit, source: 'model' as const };
}

function evidence(
	metric: RadarEvidence['metric'],
	limit: RadarEvidence['limit'],
	basis: string,
	rule: string
): RadarEvidence {
	return {
		metric: {
			...metric,
			value: round(metric.value, metric.unit === 'ratio' ? 2 : 1),
		},
		limit,
		excess: limit
			? round(metric.value - limit.value, metric.unit === 'ratio' ? 2 : 1)
			: null,
		basis,
		rule,
	};
}

function assetAction(
	symbol: string,
	pct: number,
	ctx: EvidenceContext
): RadarAction | undefined {
	const holding = ctx.holdings.find((item) => item.symbol === symbol);
	const total = ctx.analysis.facts.totalValue;
	if (!holding || pct <= ctx.policy.maxAssetWeightPct) return undefined;

	const sale = reductionToLimit({
		positionValue: (pct / 100) * total,
		totalValue: total,
		limitPct: ctx.policy.maxAssetWeightPct,
		price: holding.price,
		assetType: holding.assetType,
	});
	if (!sale || sale.quantity > holding.quantity) return undefined;

	const tax =
		holding.totalCost === null ? null : ctx.estimateTax(holding, sale.quantity);
	return {
		kind: 'reduce_position',
		symbol,
		...sale,
		estimatedTax: tax ? tax.estimatedTax : null,
		taxClassification: tax ? tax.classification : null,
		assumptions: tax
			? TAX_ASSUMPTIONS
			: holding.totalCost === null
				? ['Sem preço médio da posição, o IR da venda não pode ser estimado.']
				: ['O motor fiscal não conseguiu estimar o IR desta venda agora.'],
	};
}

function engineEvidence(
	alert: PortfolioErrorRadarAlert,
	ctx: EvidenceContext
): Pick<PortfolioErrorRadarAlert, 'evidence' | 'action'> {
	const { facts, estimates, rules } = ctx.analysis;
	const t = rules.thresholds;
	const { policy, basis } = ctx;
	const topAsset = facts.concentrationByAsset[0];
	const topClass = facts.allocationByClass[0];
	const topSector = facts.concentrationBySector.find(
		(s) => s.key !== 'UNKNOWN'
	);

	switch (alert.code) {
		case 'ASSET_CONCENTRATION_HIGH':
		case 'ASSET_CONCENTRATION_MEDIUM':
			if (!topAsset) return {};
			return {
				evidence: evidence(
					{
						label: `Peso de ${topAsset.key}`,
						value: topAsset.percentage,
						unit: 'pct',
					},
					policyLimit(
						'Limite por ativo da sua política',
						policy.maxAssetWeightPct
					),
					basis,
					`Peso = valor da posição ÷ valor total da carteira. O alerta do modelo dispara em ${t.mediumAssetConcentrationPct}% (moderado) e ${t.highAssetConcentrationPct}% (alto).`
				),
				action: assetAction(topAsset.key, topAsset.percentage, ctx),
			};
		case 'SECTOR_CONCENTRATION_HIGH':
		case 'SECTOR_CONCENTRATION_MEDIUM':
			if (!topSector) return {};
			return {
				evidence: evidence(
					{
						label: `Peso do setor ${topSector.key}`,
						value: topSector.percentage,
						unit: 'pct',
					},
					policyLimit(
						'Limite por setor da sua política',
						policy.maxSectorWeightPct
					),
					basis,
					`Soma dos pesos das posições do setor. O alerta do modelo dispara em ${t.mediumSectorConcentrationPct}% (moderado) e ${t.highSectorConcentrationPct}% (alto).`
				),
			};
		case 'CLASS_CONCENTRATION_HIGH':
			if (!topClass) return {};
			return {
				evidence: evidence(
					{
						label: `Peso de ${classLabel(topClass.key)}`,
						value: topClass.percentage,
						unit: 'pct',
					},
					modelLimit(
						'Limite do modelo por classe',
						t.highClassConcentrationPct,
						'pct'
					),
					basis,
					'Soma dos pesos das posições da classe.'
				),
			};
		case 'DIVERSIFICATION_POOR':
		case 'DIVERSIFICATION_MODERATE': {
			const d = estimates.diversification;
			return {
				evidence: evidence(
					{ label: 'Nota de diversificação', value: d.score, unit: 'score' },
					modelLimit(
						alert.code === 'DIVERSIFICATION_POOR'
							? 'Mínimo para não ser baixa'
							: 'Mínimo para ser boa',
						alert.code === 'DIVERSIFICATION_POOR' ? 40 : 65,
						'score'
					),
					`${basis} Componentes: ativos ${round(d.components.assetSpread)}, classes ${round(d.components.classSpread)}, setores ${round(d.components.sectorSpread)}.`,
					`Nota de 0 a ${d.maxScore} pelo espalhamento entre ativos, classes e setores.`
				),
			};
		}
		case 'UNKNOWN_SECTOR_EXPOSURE_HIGH':
			return {
				evidence: evidence(
					{
						label: 'Carteira sem setor identificado',
						value: facts.unknownSectorExposurePct,
						unit: 'pct',
					},
					modelLimit('Limite do modelo', 35, 'pct'),
					basis,
					'Soma dos pesos das posições sem setor conhecido.'
				),
			};
		case 'VOLATILITY_HIGH':
		case 'VOLATILITY_MEDIUM':
			return {
				evidence: evidence(
					{
						label: 'Volatilidade ponderada',
						value: estimates.risk.weightedVolatility * 100,
						unit: 'pct',
					},
					modelLimit(
						'Limite do modelo',
						alert.code === 'VOLATILITY_HIGH' ? 45 : 30,
						'pct'
					),
					basis,
					'Média da volatilidade de cada posição, ponderada pelo peso.'
				),
			};
		case 'BETA_HIGH':
			return {
				evidence: evidence(
					{
						label: 'Beta ponderado',
						value: estimates.risk.weightedBeta,
						unit: 'ratio',
					},
					modelLimit('Limite do modelo', 1.2, 'ratio'),
					basis,
					'Média do beta de cada posição contra o mercado, ponderada pelo peso.'
				),
			};
		default:
			return {};
	}
}

/** Alertas a partir da política do usuário, onde o motor não disparou. */
function policyAlerts(
	existing: PortfolioErrorRadarAlert[],
	ctx: EvidenceContext
): PortfolioErrorRadarAlert[] {
	const { facts } = ctx.analysis;
	const { policy, basis } = ctx;
	const flaggedAssets = new Set(
		existing.map((alert) => alert.symbol).filter(Boolean)
	);
	const hasSectorAlert = existing.some((alert) =>
		alert.code.startsWith('SECTOR_CONCENTRATION_')
	);
	const alerts: PortfolioErrorRadarAlert[] = [];

	const overLimit = facts.concentrationByAsset
		.filter(
			(entry) =>
				entry.percentage > policy.maxAssetWeightPct &&
				!flaggedAssets.has(entry.key)
		)
		.slice(0, MAX_POLICY_ASSET_ALERTS);
	for (const entry of overLimit) {
		const pct = formatPctBr(entry.percentage);
		alerts.push({
			code: 'POLICY_ASSET_LIMIT',
			type: 'concentration',
			severity:
				entry.percentage >= 2 * policy.maxAssetWeightPct ? 'high' : 'medium',
			message: `${entry.key} está em ${pct}% da carteira, acima do limite de ${formatPctBr(policy.maxAssetWeightPct)}% da sua política.`,
			symbol: entry.key,
			evidence: evidence(
				{ label: `Peso de ${entry.key}`, value: entry.percentage, unit: 'pct' },
				policyLimit(
					'Limite por ativo da sua política',
					policy.maxAssetWeightPct
				),
				basis,
				'Peso = valor da posição ÷ valor total da carteira.'
			),
			action: assetAction(entry.key, entry.percentage, ctx),
		});
	}

	const sector = facts.concentrationBySector.find((s) => s.key !== 'UNKNOWN');
	if (
		!hasSectorAlert &&
		sector &&
		sector.percentage > policy.maxSectorWeightPct
	) {
		alerts.push({
			code: 'POLICY_SECTOR_LIMIT',
			type: 'concentration',
			severity: 'medium',
			message: `O setor ${sector.key} está em ${formatPctBr(sector.percentage)}% da carteira, acima do limite de ${formatPctBr(policy.maxSectorWeightPct)}% da sua política.`,
			evidence: evidence(
				{
					label: `Peso do setor ${sector.key}`,
					value: sector.percentage,
					unit: 'pct',
				},
				policyLimit(
					'Limite por setor da sua política',
					policy.maxSectorWeightPct
				),
				basis,
				'Soma dos pesos das posições do setor.'
			),
		});
	}

	const crypto = facts.allocationByClass.find(
		(entry) => entry.key === 'crypto'
	);
	if (crypto && crypto.percentage > policy.maxCryptoPct) {
		alerts.push({
			code: 'POLICY_CRYPTO_LIMIT',
			type: 'concentration',
			severity: 'medium',
			message: `Cripto está em ${formatPctBr(crypto.percentage)}% da carteira, acima do limite de ${formatPctBr(policy.maxCryptoPct)}% da sua política.`,
			evidence: evidence(
				{ label: 'Peso de cripto', value: crypto.percentage, unit: 'pct' },
				policyLimit('Limite de cripto da sua política', policy.maxCryptoPct),
				basis,
				'Soma dos pesos das posições em cripto.'
			),
		});
	}
	return alerts;
}

export function withEvidence(
	alerts: PortfolioErrorRadarAlert[],
	ctx: EvidenceContext
): PortfolioErrorRadarAlert[] {
	const enriched = alerts.map((alert) => ({
		...alert,
		...engineEvidence(alert, ctx),
	}));
	return [...enriched, ...policyAlerts(enriched, ctx)];
}
