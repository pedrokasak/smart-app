import { termsFor, type TermKey } from 'src/ai/didactic/didactic-glossary';
import { money, pct } from 'src/ai/didactic/didactic-format';
import type {
	DidacticAnswer,
	DidacticLevel,
} from 'src/ai/didactic/didactic.types';
import {
	CONCENTRATED_PAYER_SHARE_PCT,
	type DividendIncomeFacts,
	type DividendTrap,
} from '../domain/dividend-income';

/**
 * Bloco "Como sua renda de proventos pode crescer" no nível da pessoa
 * (docs/requisitos/ia-didatica.md, RF-8). Reescreve os fatos de
 * `analyzeDividendIncome`; não escolhe ativo nem diz o que comprar.
 */

const duration = (months: number | null): string => {
	if (months === null) return 'mais de 100 anos';
	if (months < 12) return `${months} ${months === 1 ? 'mês' : 'meses'}`;
	const years = Math.floor(months / 12);
	const rest = months % 12;
	const yearsText = `${years} ${years === 1 ? 'ano' : 'anos'}`;
	return rest
		? `${yearsText} e ${rest} ${rest === 1 ? 'mês' : 'meses'}`
		: yearsText;
};

function trapSentence(trap: DividendTrap, level: DidacticLevel): string {
	if (trap.kind === 'price_drop') {
		const drop = pct(Math.abs(trap.priceChangePct ?? 0), 0);
		return level === 'avancado'
			? `${trap.symbol}: DY ${pct(trap.yieldOnMarketPct)} com preço ${drop} abaixo do custo médio; yield inflado pela queda.`
			: `${trap.symbol} paga ${pct(trap.yieldOnMarketPct)} ao ano sobre o preço de hoje, mas o preço caiu ${drop} desde a sua compra: o yield alto vem da queda, e uma empresa em dificuldade pode cortar o provento.`;
	}
	const share = pct(trap.largestPayoutSharePct ?? 0, 0);
	return level === 'avancado'
		? `${trap.symbol}: um pagamento = ${share} dos proventos de 12 meses; provável extraordinário, não recorrente.`
		: `Em ${trap.symbol}, um único pagamento foi ${share} de tudo o que ele pagou no ano: parece extraordinário e pode não se repetir.`;
}

function goalSentence(
	goal: NonNullable<DividendIncomeFacts['goal']>,
	level: DidacticLevel
): string | null {
	const { monthsReinvesting: reinvest, monthsSpending: spend } = goal;
	if (reinvest === 0) return null;
	if (level === 'avancado') {
		return `Meta "${goal.title}" (${money(goal.targetAmount)}): ${duration(reinvest)} reinvestindo vs ${duration(spend)} sacando os proventos, pelo retorno real do seu plano.`;
	}
	const gap =
		reinvest !== null && spend !== null && spend > reinvest
			? ` São ${duration(spend - reinvest)} de diferença.`
			: '';
	return `Na sua meta "${goal.title}" (${money(goal.targetAmount)}), reinvestindo os proventos você chega em ${duration(reinvest)}; gastando os proventos, em ${duration(spend)}.${gap} A conta usa o retorno e o aporte do seu planejamento.`;
}

export function explainDividendIncome(
	facts: DividendIncomeFacts,
	level: DidacticLevel
): DidacticAnswer | null {
	if (!(facts.total12m > 0)) return null;

	const top = facts.payers[0];
	const concentrated =
		top !== undefined && top.sharePct >= CONCENTRATED_PAYER_SHARE_PCT;
	const [in5, in10] = facts.projection;
	const goal = facts.goal ? goalSentence(facts.goal, level) : null;
	const traps = facts.traps.map((trap) => trapSentence(trap, level));
	const approximated = facts.approximated
		? ' Parte das posições é mais nova que 12 meses, então o valor real recebido foi um pouco menor.'
		: '';

	const options = [
		level === 'avancado'
			? 'Reinvestimento dos proventos: renda cresce à taxa do DY.'
			: 'Reinvestir os proventos: cada cota comprada com eles também passa a pagar, e a renda cresce sozinha.',
		level === 'avancado'
			? 'Constância pesa mais que valor: histórico recorrente reduz o risco de corte.'
			: 'Olhar a constância dos pagamentos, não só o valor: um ano bom pode não se repetir.',
		...(concentrated
			? [
					level === 'avancado'
						? `Concentração de renda: ${top.symbol} = ${pct(top.sharePct, 0)} dos proventos.`
						: `Espalhar a renda entre mais pagadores: hoje ${top.symbol} responde por ${pct(top.sharePct, 0)} dos seus proventos.`,
				]
			: []),
	];
	const terms: TermKey[] = [
		'provento',
		'dividend_yield',
		...(level === 'iniciante' ? [] : (['yield_on_cost'] as TermKey[])),
		'reinvestimento',
		...(facts.projection.length ? (['reais_de_hoje'] as TermKey[]) : []),
		...(concentrated ? (['concentracao'] as TermKey[]) : []),
	];
	const projectionText = in5 && in10;
	const why = [
		projectionText
			? level === 'avancado'
				? `Reinvestindo a DY constante: ${money(in5.monthlyIncome)}/mês em 5 anos e ${money(in10.monthlyIncome)}/mês em 10 (reais de hoje).`
				: `Reinvestindo os proventos, e se os pagamentos se mantiverem, a renda mensal pode chegar a ${money(in5.monthlyIncome)} em 5 anos e ${money(in10.monthlyIncome)} em 10 anos, em reais de hoje${facts.projectionExcludesOneOff ? ', sem contar os pagamentos extraordinários' : ''}.`
			: null,
		goal,
		...traps.map((text) => `Atenção: ${text}`),
	].filter(Boolean) as string[];

	const payersText = facts.payers
		.map((payer) => `${payer.symbol} (${pct(payer.sharePct, 0)})`)
		.join(', ');
	const yieldMarket =
		facts.yieldOnMarketPct !== null ? pct(facts.yieldOnMarketPct) : null;
	const yieldCost =
		facts.yieldOnCostPct !== null ? pct(facts.yieldOnCostPct) : null;

	if (level === 'iniciante') {
		return {
			level,
			answer: `Nos últimos 12 meses seus investimentos pagaram cerca de ${money(facts.total12m)} em proventos, uns ${money(facts.monthlyAvg)} por mês.`,
			meaning: `Provento é a parte do lucro que empresas e fundos imobiliários dividem com quem tem a ação ou a cota.${yieldMarket ? ` Hoje essa renda é ${yieldMarket} do que sua carteira vale por ano.` : ''}${payersText ? ` Quem mais paga: ${payersText}.` : ''}${approximated}`,
			whyItMatters: why.join(' ') || null,
			options,
			terms: termsFor(terms, level),
			followUps: [],
		};
	}

	if (level === 'intermediario') {
		return {
			level,
			answer: `${money(facts.total12m)} em proventos em 12 meses (${money(facts.monthlyAvg)}/mês)${yieldMarket ? `: yield de ${yieldMarket} sobre o valor de mercado` : ''}${yieldCost ? ` e ${yieldCost} sobre o seu custo` : ''}.`,
			meaning: `${payersText ? `Maiores pagadores: ${payersText}. ` : ''}A renda cresce por três caminhos: reinvestir os proventos, aportar mais e os pagadores aumentarem o que distribuem.${approximated}`,
			whyItMatters: why.join(' ') || null,
			options,
			terms: termsFor(terms, level),
			followUps: [],
		};
	}

	return {
		level,
		answer: `${money(facts.total12m)} em 12m${yieldMarket ? `; DY ${yieldMarket}` : ''}${yieldCost ? `, YoC ${yieldCost}` : ''}${top ? `; maior pagador ${top.symbol} (${pct(top.sharePct, 0)})` : ''}.`,
		meaning: payersText
			? `Top pagadores: ${payersText}.${approximated}`
			: approximated.trim() || null,
		whyItMatters: why.join(' ') || null,
		options,
		terms: termsFor(terms, level),
		followUps: [],
	};
}
