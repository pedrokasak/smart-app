import type { InvestmentPolicy } from 'src/investment-policy/domain/investment-policy';
import { termsFor, type TermKey } from './didactic-glossary';
import {
	FOLLOW_UPS,
	contributionFollowUp,
	taxFollowUp,
} from './didactic-follow-ups';
import {
	DECISION_NOTE,
	bucketLabel,
	money,
	num,
	pct,
	pp,
} from './didactic-format';
import type { DidacticAnswer, DidacticLevel } from './didactic.types';
import { isPortfolioAssetListQuestion } from 'src/ai/orchestration/portfolio-asset-list-question';

/**
 * Copiloto didático (docs/requisitos/ia-didatica.md). Cada intenção vira
 * resposta direta + o que significa + por que importa + opções + termos +
 * perguntas de continuação, no nível da pessoa. Só formata números que o
 * orquestrador já calculou: nada aqui chama LLM nem estima valor novo.
 * Intenção sem compositor devolve `null` e o Copiloto usa o texto de sempre.
 */

export interface DidacticContext {
	level: DidacticLevel;
	/** `null` quando a política não pôde ser lida. */
	policy: InvestmentPolicy | null;
	/** Política padrão do Trackerr: a pessoa ainda não salvou a dela. */
	policyIsDefault: boolean;
}

export interface DidacticInput {
	intent: string;
	question: string;
	data: Record<string, any>;
}

type Draft = Omit<DidacticAnswer, 'level' | 'terms'> & { terms: TermKey[] };

const RISK_LEVEL_LABEL: Record<string, string> = {
	low: 'baixo',
	medium: 'médio',
	high: 'alto',
};

const DIVERSIFICATION_LABEL: Record<string, string> = {
	poor: 'baixa',
	moderate: 'moderada',
	good: 'boa',
	excellent: 'excelente',
};

const FLAG_LABEL: Record<string, string> = {
	ASSET_CONCENTRATION_HIGH: 'concentração alta em ativo',
	ASSET_CONCENTRATION_MEDIUM: 'concentração moderada em ativo',
	CLASS_CONCENTRATION_HIGH: 'concentração alta em classe',
	SECTOR_CONCENTRATION_HIGH: 'concentração alta em setor',
	SECTOR_CONCENTRATION_MEDIUM: 'concentração moderada em setor',
	UNKNOWN_SECTOR_EXPOSURE_HIGH: 'exposição alta sem setor identificado',
	DIVERSIFICATION_POOR: 'diversificação baixa',
	DIVERSIFICATION_MODERATE: 'diversificação moderada',
	VOLATILITY_HIGH: 'volatilidade alta',
	VOLATILITY_MEDIUM: 'volatilidade moderada',
	BETA_HIGH: 'beta alto',
};

/** Mesma precedência do texto clássico: `weightPct`, depois `percentage`. */
function concentrationPct(entry: any): number {
	for (const candidate of [entry?.weightPct, entry?.percentage]) {
		const value = Number(candidate);
		if (Number.isFinite(value) && value > 0) return value;
	}
	return 0;
}

/** Choque usado nos exemplos de "por que importa": uma queda de 20% num dia ruim. */
const SHOCK = 0.2;

function portfolioRisk(
	input: DidacticInput,
	ctx: DidacticContext
): Draft | null {
	const risk = input.data?.portfolioRisk;
	const top = risk?.concentrationByAsset?.[0];
	if (!risk?.risk || !top) return null;

	const symbol = String(top.symbol || top.key);
	const weight = concentrationPct(top);
	const value = Number(top.value ?? 0);
	const total = weight > 0 && value > 0 ? value / (weight / 100) : 0;
	const loss = value * SHOCK;
	const level = RISK_LEVEL_LABEL[risk.risk.level] ?? 'médio';
	const score = Math.round(Number(risk.risk.score ?? 0));
	const sector = (risk.concentrationBySector ?? []).find(
		(entry: any) => entry.key !== 'UNKNOWN'
	);
	const limit = ctx.policy?.maxAssetWeightPct ?? null;
	const overLimit = limit !== null && weight > limit;
	const limitNoun = ctx.policyIsDefault
		? 'limite padrão do Trackerr'
		: 'limite que você definiu na sua política';
	const limitSentence =
		limit === null
			? ''
			: overLimit
				? ` Para comparar: o ${limitNoun} é ${pct(limit)}.`
				: ` Está dentro do ${limitNoun}, de ${pct(limit)}.`;
	const options = overLimit
		? [
				`Colocar os próximos aportes em outros ativos até ${symbol} voltar a perto de ${pct(limit as number)}.`,
				'Vender uma parte, sabendo que pode haver imposto sobre o lucro.',
				ctx.policyIsDefault
					? `Definir o seu próprio limite em Configurações, se ${pct(limit as number)} não combina com você.`
					: `Rever o limite de ${pct(limit as number)} na sua política, se ele ficou apertado para você.`,
			]
		: [];
	const followUps = [
		FOLLOW_UPS.correlation.question,
		taxFollowUp(symbol).question,
		FOLLOW_UPS.allocationGap.question,
	];

	if (ctx.level === 'iniciante') {
		return {
			answer: `O risco da sua carteira está em nível ${level}, e vem principalmente de ${symbol}, que sozinha é ${pct(weight)} de tudo o que você investiu.`,
			meaning: `Pense na carteira como uma cesta de ovos: quanto mais ovos numa cesta só, mais um tropeço quebra de uma vez. ${symbol} é a cesta mais cheia: de cada R$ 100 que você tem, ${money(weight)} estão nela.`,
			whyItMatters:
				loss > 0
					? `Se ${symbol} cair 20% num dia ruim, você perde cerca de ${money(loss)} só por causa dela, mesmo que todo o resto fique parado.${limitSentence}`
					: `Uma notícia ruim sobre ${symbol} mexe no resultado da carteira inteira.${limitSentence}`,
			options,
			terms: ['concentracao', 'politica'],
			followUps,
		};
	}

	if (ctx.level === 'intermediario') {
		const excess = overLimit
			? `, ${pp(weight - (limit as number))} acima do ${limitNoun} (${pct(limit as number)})`
			: '';
		return {
			answer: `Risco ${level} (score ${score} de 100), com a maior concentração em ${symbol}: ${pct(weight)} do patrimônio${excess}.`,
			meaning: `O score soma concentração, diversificação, volatilidade e beta. Aqui o que mais pesa é a posição em ${symbol}${sector ? ` e o setor ${sector.key}, com ${pct(sector.percentage)} da carteira` : ''}.`,
			whyItMatters:
				loss > 0 && total > 0
					? `Uma queda de 20% em ${symbol} tira ${money(loss)} do patrimônio, ou ${pct((loss / total) * 100)} do total.`
					: null,
			options,
			terms: [
				'risco_score',
				'concentracao',
				...(overLimit ? (['pp'] as TermKey[]) : []),
			],
			followUps,
		};
	}

	const flags = (risk.risk.flags ?? [])
		.map(
			(flag: any) => FLAG_LABEL[typeof flag === 'string' ? flag : flag?.code]
		)
		.filter(Boolean);
	return {
		answer: `Score de risco ${score}/100 (${level}); maior posição ${symbol} com ${pct(weight)}${sector ? `, maior setor ${sector.key} com ${pct(sector.percentage)}` : ''}${overLimit ? `; ${pp(weight - (limit as number))} acima do limite${ctx.policyIsDefault ? ' padrão' : ' da política'} (${pct(limit as number)})` : ''}.`,
		meaning: flags.length
			? `Sinais ativos: ${flags.join(', ')}.`
			: 'Nenhum sinal de risco ativo além da concentração.',
		whyItMatters:
			loss > 0 && total > 0
				? `Choque de -20% em ${symbol}: ${money(loss)} (${pct((loss / total) * 100)} do patrimônio).`
				: null,
		options,
		terms: ['risco_score'],
		followUps: [
			FOLLOW_UPS.correlation.question,
			FOLLOW_UPS.attribution.question,
			taxFollowUp(symbol).question,
		],
	};
}

/** Diferença menor que meio ponto não diz nada sobre valorização. */
function yieldReading(yieldCost: number, yieldMarket: number): string {
	if (Math.abs(yieldCost - yieldMarket) < 0.5) {
		return 'Yield sobre o custo e yield de mercado estão próximos: os preços estão perto do que você pagou.';
	}
	return yieldCost > yieldMarket
		? 'Yield sobre o custo acima do yield de mercado indica que os ativos valorizaram desde a compra.'
		: 'Yield sobre o custo abaixo do yield de mercado indica que os ativos desvalorizaram desde a compra.';
}

function dividendsReceived(
	input: DidacticInput,
	ctx: DidacticContext
): Draft | null {
	const received = input.data?.dividendsReceived;
	const total = Number(received?.total12m ?? 0);
	if (!received || !(total > 0)) return null;

	const payers: Array<{ symbol: string; amount: number }> =
		received.topPayers ?? [];
	const yieldMarket =
		typeof received.yieldOnMarket === 'number'
			? received.yieldOnMarket * 100
			: null;
	const yieldCost =
		typeof received.yieldOnCost === 'number'
			? received.yieldOnCost * 100
			: null;
	const top = payers[0];
	const topShare = top ? (top.amount / total) * 100 : null;
	const payersText = payers
		.map((p) => `${p.symbol} (${money(p.amount)})`)
		.join(', ');
	const approximated = received.approximated
		? ' A conta usa a quantidade que você tem hoje; se comprou parte no meio do período, o valor recebido foi menor.'
		: '';
	const howToImprove = [
		'Reinvestir os proventos todo mês: cada cota comprada passa a pagar proventos também.',
		'Olhar a constância, não só o valor: um provento alto pode vir de um preço que caiu ou de um pagamento extraordinário.',
		...(topShare !== null && topShare >= 40
			? [
					`Espalhar a renda: hoje ${top.symbol} paga ${pct(topShare, 0)} dos seus proventos.`,
				]
			: []),
	];
	const followUps = [
		FOLLOW_UPS.risk.question,
		FOLLOW_UPS.summary.question,
		FOLLOW_UPS.checklist.question,
	];

	if (ctx.level === 'iniciante') {
		return {
			answer: `Nos últimos 12 meses seus investimentos pagaram cerca de ${money(total)} em proventos, uns ${money(total / 12)} por mês.`,
			meaning: `Provento é o dinheiro que empresas e fundos imobiliários dividem com quem tem a ação ou a cota.${payersText ? ` Quem mais pagou: ${payersText}.` : ''}${approximated}`,
			whyItMatters:
				yieldMarket !== null
					? `Esse valor é ${pct(yieldMarket)} do que a sua carteira vale hoje. Reinvestido, ele compra mais cotas, que pagam mais proventos: é a bola de neve dos juros compostos.`
					: 'Reinvestido, esse dinheiro compra mais cotas, que pagam mais proventos: é a bola de neve dos juros compostos.',
			options: howToImprove,
			terms: [
				'provento',
				...(yieldMarket !== null ? (['dividend_yield'] as TermKey[]) : []),
			],
			followUps,
		};
	}

	if (ctx.level === 'intermediario') {
		return {
			answer: `${money(total)} em proventos nos últimos 12 meses${yieldMarket !== null ? `: yield de ${pct(yieldMarket)} sobre o valor de mercado` : ''}${yieldCost !== null ? ` e ${pct(yieldCost)} sobre o seu custo` : ''}.`,
			meaning:
				yieldMarket !== null && yieldCost !== null
					? `${yieldReading(yieldCost, yieldMarket)}${payersText ? ` Maiores pagadores: ${payersText}.` : ''}`
					: `Maiores pagadores: ${payersText || 'não identificados'}.${approximated}`,
			whyItMatters:
				topShare !== null
					? `${top.symbol} responde por ${pct(topShare, 0)} da sua renda de proventos: um corte nele pesa direto no seu fluxo mensal.`
					: null,
			options: howToImprove,
			terms: ['dividend_yield', 'yield_on_cost'],
			followUps,
		};
	}

	return {
		answer: `${money(total)} em 12 meses${yieldMarket !== null ? `; DY ${pct(yieldMarket)} a mercado` : ''}${yieldCost !== null ? `, YoC ${pct(yieldCost)}` : ''}.`,
		meaning: payersText
			? `Top pagadores: ${payersText}.${approximated}`
			: approximated.trim() || null,
		whyItMatters:
			topShare !== null
				? `Concentração de renda: ${top.symbol} = ${pct(topShare, 0)} dos proventos.`
				: null,
		options: howToImprove.slice(1),
		terms: ['dividend_yield', 'yield_on_cost'],
		followUps,
	};
}

/**
 * `totalDriftPct` soma os desvios de todas as classes: o que sobra numa é o
 * que falta na outra, então a parte da carteira fora do lugar é a metade.
 */
const outOfPlace = (rebalancing: any) =>
	Number(rebalancing?.totalDriftPct ?? 0) / 2;

function allocationGap(
	input: DidacticInput,
	ctx: DidacticContext
): Draft | null {
	const rebalancing = input.data?.rebalancing;
	if (!rebalancing) return null;

	if (!rebalancing.hasTarget) {
		return {
			answer:
				'Você ainda não definiu uma meta de alocação, então não dá para medir onde a carteira está fora do plano.',
			meaning:
				ctx.level === 'avancado'
					? 'Sem pesos-alvo por classe na política, o desvio não é calculado.'
					: 'Meta de alocação é a divisão que você quer ter, como "25% em renda fixa e 40% em ações". Ela fica na sua política de investimento, em Configurações.',
			whyItMatters:
				ctx.level === 'avancado'
					? null
					: 'Com a meta definida, o Trackerr mostra quando a carteira se afasta do plano e para onde mandar cada aporte.',
			options: [],
			terms: ['alocacao_alvo', 'politica'],
			followUps: [FOLLOW_UPS.risk.question, FOLLOW_UPS.summary.question],
		};
	}

	const buckets: any[] = (rebalancing.buckets ?? []).filter(
		(bucket: any) => Math.abs(Number(bucket.gapPct)) >= 1
	);
	if (!buckets.length) {
		return {
			answer:
				'Sua carteira está alinhada à meta de alocação: nenhuma classe passa de 1 p.p. de diferença.',
			meaning:
				ctx.level === 'avancado'
					? `${pct(outOfPlace(rebalancing))} da carteira fora da meta.`
					: 'Cada tipo de investimento está perto da fatia que você planejou.',
			whyItMatters: null,
			options: [],
			terms: ['alocacao_alvo'],
			followUps: [FOLLOW_UPS.risk.question, FOLLOW_UPS.dividends.question],
		};
	}

	// gapPct do servidor = alvo − atual: positivo é falta.
	const sorted = [...buckets].sort(
		(a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct)
	);
	const largest = sorted[0];
	const over = sorted.filter((b) => b.gapPct < 0);
	const under = sorted.filter((b) => b.gapPct > 0);
	const describe = (b: any) =>
		`${bucketLabel(b.bucket)} em ${pct(b.currentPct)} contra a meta de ${pct(b.targetPct)}`;
	const contributionAmount = under.reduce(
		(sum, b) => sum + Math.abs(Number(b.amount) || 0),
		0
	);
	const options = [
		...(under.length
			? [
					`Mandar os próximos aportes para ${under.map((b) => bucketLabel(b.bucket)).join(' e ')}, que estão abaixo da meta: assim a carteira volta ao plano sem vender nada.`,
				]
			: []),
		'Rever a meta na sua política, se o plano mudou.',
	];
	const followUps = [
		...(contributionAmount > 0
			? [
					contributionFollowUp(
						money(Math.max(100, Math.round(contributionAmount / 100) * 100))
					).question,
				]
			: []),
		FOLLOW_UPS.risk.question,
		FOLLOW_UPS.checklist.question,
	];
	const lines = sorted.map(
		(b) =>
			`${bucketLabel(b.bucket)}: ${b.gapPct < 0 ? '+' : '-'}${pp(b.gapPct)} (${b.gapPct < 0 ? 'acima' : 'abaixo'}, ${money(Math.abs(b.amount))})`
	);

	if (ctx.level === 'iniciante') {
		return {
			answer: `A parte maior fora do plano é ${describe(largest)}.`,
			meaning:
				'Meta de alocação é a divisão que você planejou entre os tipos de investimento. Quando um tipo sobe mais que os outros, a carteira se afasta do plano sozinha, sem você fazer nada.',
			whyItMatters: over.length
				? `Com ${bucketLabel(over[0].bucket)} acima da meta, você está mais exposto a esse tipo do que escolheu: se ele cair, você perde mais do que esperava.`
				: `Com ${bucketLabel(largest.bucket)} abaixo da meta, a carteira está mais concentrada nos outros tipos do que você planejou.`,
			options,
			terms: ['alocacao_alvo', 'rebalancear'],
			followUps,
		};
	}

	if (ctx.level === 'intermediario') {
		return {
			answer: `${pct(outOfPlace(rebalancing))} da carteira está fora da meta; o maior desvio é ${describe(largest)}.`,
			meaning: `Por classe: ${lines.join('; ')}.`,
			whyItMatters:
				'Rebalancear com aportes, em vez de vender, evita IR sobre o lucro e custo de corretagem.',
			options,
			terms: ['alocacao_alvo', 'rebalancear', 'pp'],
			followUps,
		};
	}

	return {
		answer: `Fora da meta: ${pct(outOfPlace(rebalancing))} da carteira (soma dos gaps ${pp(rebalancing.totalDriftPct ?? 0)}); maior desvio: ${describe(largest)}.`,
		meaning: lines.join('; ') + '.',
		whyItMatters:
			'Rebalanceamento via aporte preserva a base de custo e não realiza ganho tributável.',
		options: options.slice(0, 1),
		terms: ['rebalancear'],
		followUps,
	};
}

function sellOrTax(input: DidacticInput, ctx: DidacticContext): Draft | null {
	const sim = input.data?.sellSimulation;
	if (!sim || typeof sim.realizedPnl !== 'number') return null;

	const symbol = String(sim.symbol);
	const pnl = Number(sim.realizedPnl);
	const tax = Number(sim.estimatedTax ?? 0);
	const rate = Number(sim.taxRateApplied ?? 0) * 100;
	const exempt = !!sim.monthlyExemptionApplied;
	const avg = Number(sim.averagePrice ?? 0);
	const compensation = Number(sim.compensationUsed ?? 0);
	const taxableBase = Number(sim.taxableBaseAfterCompensation ?? 0);
	const loss = pnl < 0;
	const terms: TermKey[] = [
		'ganho_capital',
		'preco_medio',
		...(exempt ? (['isencao_20k'] as TermKey[]) : []),
		...(loss || compensation > 0
			? (['prejuizo_compensavel'] as TermKey[])
			: []),
	];
	const compensationSentence =
		compensation > 0
			? ` ${money(compensation)} de prejuízo de vendas anteriores abatem esse lucro, e o imposto incide sobre ${money(taxableBase)}.`
			: '';
	const answer = loss
		? `Vendendo ${symbol}, você teria um prejuízo de cerca de ${money(Math.abs(pnl))}, sem imposto a pagar.`
		: tax > 0
			? `Vendendo ${symbol}, o lucro seria de cerca de ${money(pnl)}, com ${money(tax)} de imposto.`
			: `Vendendo ${symbol}, o lucro seria de cerca de ${money(pnl)}, sem imposto${exempt ? ' pela isenção do mês' : ''}.`;
	const options = loss
		? [
				'Guardar esse prejuízo: ele pode abater o lucro de vendas futuras e reduzir o imposto.',
			]
		: exempt || sim.assetType !== 'stock'
			? []
			: [
					'Dividir a venda em meses diferentes: em ações, vendas de até R$ 20 mil no mês não pagam imposto sobre o lucro.',
				];
	const followUps = [FOLLOW_UPS.risk.question, FOLLOW_UPS.checklist.question];

	if (ctx.level === 'iniciante') {
		return {
			answer,
			meaning: `O imposto não é sobre o valor da venda, é só sobre o lucro: a diferença entre o preço de venda e o preço médio que você pagou${avg > 0 ? ` (${money(avg)} por ação)` : ''}.`,
			whyItMatters: loss
				? 'Prejuízo não paga imposto e ainda pode ser descontado de lucros futuros, desde que você declare.'
				: exempt
					? 'Como suas vendas de ações no mês ficam abaixo de R$ 20 mil, o lucro é isento.'
					: rate > 0
						? `A alíquota usada foi de ${pct(rate)} sobre o lucro.${compensationSentence} A conta já considera as outras vendas do mês e os prejuízos registrados no Trackerr; operações feitas fora dele não entram.`
						: compensationSentence.trim() || null,
			options,
			terms,
			followUps,
		};
	}

	return {
		answer,
		meaning: `Ganho de ${money(pnl)} sobre o preço médio de ${money(avg)}${compensation > 0 ? `, ${money(compensation)} de prejuízo compensado, base tributável de ${money(taxableBase)}` : ''}${rate > 0 ? `, alíquota de ${pct(rate)}` : ''}${exempt ? ', isenção mensal aplicada' : ''}.`,
		whyItMatters:
			ctx.level === 'avancado'
				? 'Inclui as alienações do mês e o prejuízo acumulado registrados no Trackerr; operações externas não entram.'
				: 'A conta já considera as outras vendas do mês e os prejuízos registrados no Trackerr; operações feitas fora dele não entram.',
		options,
		terms: ctx.level === 'avancado' ? [] : terms,
		followUps,
	};
}

function portfolioSummary(
	input: DidacticInput,
	ctx: DidacticContext
): Draft | null {
	const summary = input.data?.portfolioSummary;
	const total = Number(summary?.totalValue ?? 0);
	if (!summary || !(total > 0)) return null;
	// Pedido de lista de ativos segue a resposta de sempre (lista com pesos).
	if (isPortfolioAssetListQuestion(input.question)) return null;

	const classes: any[] = (summary.allocationByClass ?? []).filter(
		(c: any) => Number(c.percentage) > 0
	);
	const split = classes
		.slice(0, 5)
		.map((c) => `${bucketLabel(c.key)} ${pct(c.percentage, 0)}`)
		.join(', ');
	const div = summary.diversification;
	const divText = div
		? `${Math.round(div.score)} de 100 (${DIVERSIFICATION_LABEL[div.status] ?? div.status})`
		: null;
	const count = Number(summary.positionsCount ?? 0);
	const followUps = [
		FOLLOW_UPS.risk.question,
		FOLLOW_UPS.dividends.question,
		FOLLOW_UPS.allocationGap.question,
	];

	if (ctx.level === 'iniciante') {
		return {
			answer: `Sua carteira vale ${money(total)}, espalhada em ${count} investimento${count === 1 ? '' : 's'}.`,
			meaning:
				`${split ? `Ela está dividida assim: ${split}.` : ''}${divText ? ` A nota de diversificação é ${divText}.` : ''}`.trim() ||
				null,
			whyItMatters:
				'Quanto mais espalhado o dinheiro entre tipos e empresas diferentes, menos um problema isolado mexe no total.',
			options: [],
			terms: ['diversificacao'],
			followUps,
		};
	}

	return {
		answer: `Patrimônio de ${money(total)} em ${count} posições.`,
		meaning:
			`${split ? `Por classe: ${split}.` : ''}${divText ? ` Diversificação ${divText}${ctx.level === 'avancado' && div?.components ? `: ativos ${num(div.components.assetSpread, 0)}, classes ${num(div.components.classSpread, 0)}, setores ${num(div.components.sectorSpread, 0)}` : ''}.` : ''}`.trim() ||
			null,
		whyItMatters: null,
		options: [],
		terms: ctx.level === 'avancado' ? [] : ['diversificacao'],
		followUps,
	};
}

const COMPOSERS: Record<
	string,
	(input: DidacticInput, ctx: DidacticContext) => Draft | null
> = {
	portfolio_risk: portfolioRisk,
	dividends_received: dividendsReceived,
	allocation_gap: allocationGap,
	sell_simulation: sellOrTax,
	tax_estimation: sellOrTax,
	portfolio_summary: portfolioSummary,
};

/** Evita ler perfil e política quando nenhuma parte da resposta tem compositor. */
export const hasDidacticComposer = (intent: string) => intent in COMPOSERS;

export function composeDidactic(
	input: DidacticInput,
	ctx: DidacticContext
): DidacticAnswer | null {
	const composer = COMPOSERS[input.intent];
	const draft = composer ? composer(input, ctx) : null;
	if (!draft) return null;
	return {
		...draft,
		level: ctx.level,
		meaning: draft.meaning || null,
		terms: termsFor(draft.terms, ctx.level),
		followUps: [...new Set(draft.followUps)].slice(0, 3),
	};
}

/**
 * Texto da bolha a partir da resposta didática, para o web atual (que lê
 * `message`) já mostrar a explicação. Termos e perguntas de continuação
 * ficam só no campo estruturado.
 */
export function renderDidactic(answer: DidacticAnswer): string {
	const parts = [answer.answer];
	if (answer.meaning) {
		parts.push(
			`${answer.level === 'avancado' ? 'Leitura' : 'O que isso significa'}: ${answer.meaning}`
		);
	}
	if (answer.whyItMatters)
		parts.push(`Por que importa: ${answer.whyItMatters}`);
	if (answer.options.length) {
		parts.push(
			`O que dá para fazer:\n${answer.options.map((option) => `• ${option}`).join('\n')}\n${DECISION_NOTE}`
		);
	}
	return parts.join('\n\n');
}
