import {
	closesToReturns,
	MIN_OBSERVATIONS,
	pairByDate,
} from './benchmark-metrics';
import { DatedReturn } from './returns';

/**
 * Matriz de correlação entre as posições da carteira (TRA-141).
 *
 * É a resposta do prompt "Matriz de correlação" do Copiloto no nível
 * avançado — o handoff entrega essa análise pelo chat, não como widget.
 *
 * ## Por que agora
 *
 * O Radar Anti-Erro deixou correlação entre ativos de fora "para não fabricar
 * um número de correlação sem base real": `MarketDataProviderPort` não expunha
 * série histórica de preço por ativo. `getDailyCloses` entrou na porta com o
 * beta, e o bloqueio deixou de valer.
 *
 * ## Mesmas duas armadilhas do beta
 *
 * Pareamento POR DATA, nunca por posição de array — um feriado que só um dos
 * lados tem desloca a série inteira e produz um número plausível e errado. E
 * mínimo de observações por PAR: correlação sobre poucos dias é ruído com
 * aparência de medida.
 */

export interface CorrelationPair {
	a: string;
	b: string;
	/** `null` quando o par não tem dias em comum suficientes. */
	correlation: number | null;
	observations: number;
}

export interface CorrelationMatrixResult {
	/** Símbolos com série utilizável, na ordem da matriz. */
	symbols: string[];
	/** `matrix[i][j]`, simétrica, diagonal 1. `null` = par sem base. */
	matrix: (number | null)[][];
	/** Pares únicos (i < j). */
	pairs: CorrelationPair[];
	/** Média dos pares calculáveis. Mede o quanto a carteira anda em bloco. */
	averageCorrelation: number | null;
	highestPair: CorrelationPair | null;
	lowestPair: CorrelationPair | null;
	/** Símbolos sem histórico suficiente — declarados, não escondidos. */
	missingSymbols: string[];
}

const round4 = (value: number): number => Number(value.toFixed(4));

/** Correlação de Pearson amostral. `null` se algum lado não varia. */
export function pearson(a: number[], b: number[]): number | null {
	const n = Math.min(a.length, b.length);
	if (n < 2) return null;

	let sumA = 0;
	let sumB = 0;
	for (let i = 0; i < n; i += 1) {
		sumA += a[i];
		sumB += b[i];
	}
	const meanA = sumA / n;
	const meanB = sumB / n;

	let covariance = 0;
	let varianceA = 0;
	let varianceB = 0;
	for (let i = 0; i < n; i += 1) {
		const da = a[i] - meanA;
		const db = b[i] - meanB;
		covariance += da * db;
		varianceA += da * da;
		varianceB += db * db;
	}

	const denominator = Math.sqrt(varianceA * varianceB);
	if (!(denominator > 0)) return null;

	// Arredondamento de ponto flutuante pode passar de 1 por um fio.
	return Math.max(-1, Math.min(1, covariance / denominator));
}

export function computeCorrelationMatrix(
	closesBySymbol: Record<string, { date: string; close: number }[]>
): CorrelationMatrixResult {
	const usable: { symbol: string; returns: DatedReturn[] }[] = [];
	const missingSymbols: string[] = [];

	for (const symbol of Object.keys(closesBySymbol || {}).sort()) {
		const returns = closesToReturns(closesBySymbol[symbol] || []);
		if (returns.length < MIN_OBSERVATIONS) {
			missingSymbols.push(symbol);
			continue;
		}
		usable.push({ symbol, returns });
	}

	const symbols = usable.map((entry) => entry.symbol);
	const size = symbols.length;
	const matrix: (number | null)[][] = Array.from({ length: size }, (_, i) =>
		Array.from({ length: size }, (_, j) => (i === j ? 1 : null))
	);
	const pairs: CorrelationPair[] = [];

	for (let i = 0; i < size; i += 1) {
		for (let j = i + 1; j < size; j += 1) {
			const paired = pairByDate(usable[i].returns, usable[j].returns);
			const observations = paired.dates.length;
			const raw =
				observations >= MIN_OBSERVATIONS ? pearson(paired.a, paired.b) : null;
			const correlation = raw === null ? null : round4(raw);

			matrix[i][j] = correlation;
			matrix[j][i] = correlation;
			pairs.push({ a: symbols[i], b: symbols[j], correlation, observations });
		}
	}

	const calculable = pairs.filter(
		(pair): pair is CorrelationPair & { correlation: number } =>
			pair.correlation !== null
	);

	const averageCorrelation = calculable.length
		? round4(
				calculable.reduce((sum, pair) => sum + pair.correlation, 0) /
					calculable.length
			)
		: null;

	const byCorrelation = [...calculable].sort(
		(x, y) => y.correlation - x.correlation
	);

	return {
		symbols,
		matrix,
		pairs,
		averageCorrelation,
		highestPair: byCorrelation[0] ?? null,
		lowestPair:
			byCorrelation.length > 1 ? byCorrelation[byCorrelation.length - 1] : null,
		missingSymbols,
	};
}
