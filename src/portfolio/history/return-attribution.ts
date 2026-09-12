/**
 * Atribuição de retorno por ativo nos últimos 12 meses (TRA-141).
 *
 * É a resposta do prompt "Atribuição de retorno 12M" do Copiloto no nível
 * avançado — o handoff entrega essa análise pelo chat, não como widget.
 *
 * ## O que este número é, e o que não é
 *
 * É a CONTRIBUIÇÃO de cada ativo para o retorno de comprar e segurar a
 * carteira de hoje ao longo da janela: `peso no início × retorno do ativo`.
 * Somando as contribuições chega-se ao retorno dessa carteira no período.
 *
 * NÃO é o retorno que o usuário teve de fato: aportes e vendas feitos durante
 * a janela não entram, porque isso exigiria reconstruir a posição dia a dia.
 * O TWR de `/portfolio/returns` responde a outra pergunta. A premissa vai em
 * `assumptions`, para a resposta dizer isso em vez de deixar implícito.
 *
 * NÃO é Brinson: separar alocação de seleção exige pesos e retornos do
 * benchmark por setor, que o produto não tem.
 *
 * ## Peso pelo valor de mercado
 *
 * O peso usa quantidade × fechamento do início da janela. Nunca `total` do
 * ativo, que é custo de aquisição — o mesmo engano que deixava a série diária
 * reta até TRA-143.
 */

export interface AttributionPosition {
	symbol: string;
	quantity: number;
	currentPrice?: number | null;
}

export interface AttributionRow {
	symbol: string;
	startPrice: number;
	endPrice: number;
	/** Retorno do ativo na janela, em fração. */
	assetReturn: number;
	/** Peso no início da janela, em fração. */
	startWeight: number;
	/** Contribuição para o retorno da carteira, em fração. */
	contribution: number;
}

export interface ReturnAttributionResult {
	from: string | null;
	to: string | null;
	/** Ordenado da maior contribuição para a menor. */
	rows: AttributionRow[];
	/** Soma das contribuições. `null` sem nenhuma linha. */
	totalReturn: number | null;
	topContributor: AttributionRow | null;
	/** Só existe quando alguém tirou retorno (contribuição negativa). */
	topDetractor: AttributionRow | null;
	missingSymbols: string[];
	assumptions: string[];
}

export const ATTRIBUTION_ASSUMPTION =
	'attribution_buy_and_hold_current_quantities';

const round6 = (value: number): number => Number(value.toFixed(6));

export function computeReturnAttribution(params: {
	positions: AttributionPosition[];
	closesBySymbol: Record<string, { date: string; close: number }[]>;
}): ReturnAttributionResult {
	const candidates: {
		symbol: string;
		quantity: number;
		startPrice: number;
		endPrice: number;
		from: string;
		to: string;
	}[] = [];
	const missingSymbols: string[] = [];

	for (const position of params.positions || []) {
		const quantity = Number(position?.quantity) || 0;
		if (quantity <= 0) continue;

		const symbol = String(position?.symbol || '').toUpperCase();
		const closes = [...(params.closesBySymbol?.[symbol] || [])]
			.filter((point) => Number.isFinite(point?.close) && point.close > 0)
			.sort((a, b) => a.date.localeCompare(b.date));

		if (closes.length < 2) {
			missingSymbols.push(symbol);
			continue;
		}

		const first = closes[0];
		const last = closes[closes.length - 1];
		const current = Number(position?.currentPrice);
		// Cotação atual quando existe: o último fechamento pode ter um dia.
		const endPrice =
			Number.isFinite(current) && current > 0 ? current : last.close;

		candidates.push({
			symbol,
			quantity,
			startPrice: first.close,
			endPrice,
			from: first.date,
			to: last.date,
		});
	}

	const startTotal = candidates.reduce(
		(sum, candidate) => sum + candidate.quantity * candidate.startPrice,
		0
	);

	if (!candidates.length || startTotal <= 0) {
		return {
			from: null,
			to: null,
			rows: [],
			totalReturn: null,
			topContributor: null,
			topDetractor: null,
			missingSymbols,
			assumptions: [ATTRIBUTION_ASSUMPTION],
		};
	}

	// Soma sobre os valores crus: somar contribuições já arredondadas acumula
	// erro de uma casa por ativo.
	const totalReturn = round6(
		candidates.reduce(
			(sum, candidate) =>
				sum +
				(candidate.quantity * (candidate.endPrice - candidate.startPrice)) /
					startTotal,
			0
		)
	);

	const rows: AttributionRow[] = candidates
		.map((candidate) => {
			const startWeight =
				(candidate.quantity * candidate.startPrice) / startTotal;
			const assetReturn = candidate.endPrice / candidate.startPrice - 1;
			return {
				symbol: candidate.symbol,
				startPrice: round6(candidate.startPrice),
				endPrice: round6(candidate.endPrice),
				assetReturn: round6(assetReturn),
				startWeight: round6(startWeight),
				contribution: round6(startWeight * assetReturn),
			};
		})
		.sort((a, b) => b.contribution - a.contribution);

	const worst = rows[rows.length - 1];

	return {
		from: candidates.map((c) => c.from).sort()[0],
		to: candidates
			.map((c) => c.to)
			.sort()
			.reverse()[0],
		rows,
		totalReturn,
		topContributor: rows[0],
		topDetractor: worst.contribution < 0 ? worst : null,
		missingSymbols,
		assumptions: [ATTRIBUTION_ASSUMPTION],
	};
}
