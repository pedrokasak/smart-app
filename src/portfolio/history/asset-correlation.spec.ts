import { computeCorrelationMatrix, pearson } from './asset-correlation';
import { MIN_OBSERVATIONS } from './benchmark-metrics';

/** N dias úteis a partir de 2025-01-06 (segunda). */
const businessDays = (n: number): string[] => {
	const out: string[] = [];
	const cursor = new Date(Date.UTC(2025, 0, 6));
	while (out.length < n) {
		const weekday = cursor.getUTCDay();
		if (weekday !== 0 && weekday !== 6) {
			out.push(cursor.toISOString().slice(0, 10));
		}
		cursor.setUTCDate(cursor.getUTCDate() + 1);
	}
	return out;
};

/** Fechamentos a partir de uma lista de retornos diários. */
const closesFrom = (returns: number[], start = 100) => {
	const days = businessDays(returns.length + 1);
	let price = start;
	const out = [{ date: days[0], close: price }];
	returns.forEach((r, i) => {
		price = price * (1 + r);
		out.push({ date: days[i + 1], close: price });
	});
	return out;
};

const wave = (n: number, amplitude = 0.01) =>
	Array.from({ length: n }, (_, i) =>
		i % 2 === 0 ? amplitude : -amplitude * 0.8
	);

describe('pearson', () => {
	it('devolve 1 para séries idênticas e -1 para opostas', () => {
		const a = [0.01, -0.02, 0.03, -0.01, 0.02];
		expect(pearson(a, a)).toBeCloseTo(1, 6);
		expect(
			pearson(
				a,
				a.map((v) => -v)
			)
		).toBeCloseTo(-1, 6);
	});

	it('devolve null quando um dos lados não varia', () => {
		expect(pearson([0.01, 0.01, 0.01], [0.01, -0.02, 0.03])).toBeNull();
	});

	it('devolve null com menos de dois pontos', () => {
		expect(pearson([0.01], [0.02])).toBeNull();
	});
});

describe('computeCorrelationMatrix', () => {
	it('monta matriz simétrica com diagonal 1', () => {
		const base = wave(40);
		const result = computeCorrelationMatrix({
			PETR4: closesFrom(base),
			VALE3: closesFrom(base.map((v) => v * 1.5)),
		});

		expect(result.symbols).toEqual(['PETR4', 'VALE3']);
		expect(result.matrix[0][0]).toBe(1);
		expect(result.matrix[1][1]).toBe(1);
		expect(result.matrix[0][1]).toBeCloseTo(1, 4);
		expect(result.matrix[0][1]).toBe(result.matrix[1][0]);
	});

	it('identifica o par que mais anda junto e o que mais se descola', () => {
		const base = wave(40);
		const result = computeCorrelationMatrix({
			AAAA3: closesFrom(base),
			BBBB3: closesFrom(base),
			CCCC3: closesFrom(base.map((v) => -v)),
		});

		expect(result.highestPair).toMatchObject({ a: 'AAAA3', b: 'BBBB3' });
		expect(result.highestPair?.correlation).toBeCloseTo(1, 4);
		expect(result.lowestPair?.correlation).toBeCloseTo(-1, 4);
	});

	it('calcula a correlação média dos pares calculáveis', () => {
		const base = wave(40);
		const result = computeCorrelationMatrix({
			AAAA3: closesFrom(base),
			BBBB3: closesFrom(base),
			CCCC3: closesFrom(base.map((v) => -v)),
		});

		// Pares: A-B = 1, A-C = -1, B-C = -1 → média -1/3.
		expect(result.averageCorrelation).toBeCloseTo(-1 / 3, 3);
	});

	// A armadilha do beta, de novo: alinhar por posição desloca a série no
	// primeiro dia que só um dos lados tem.
	it('pareia por data, não por posição', () => {
		const base = wave(40);
		const full = closesFrom(base);
		// Remove um dia do meio só de um dos lados.
		const withGap = full.filter((_, i) => i !== 15);

		const result = computeCorrelationMatrix({ AAAA3: full, BBBB3: withGap });

		// Por data, as séries continuam praticamente idênticas.
		expect(result.matrix[0][1]).toBeGreaterThan(0.9);
	});

	// Correlação sobre poucos dias é ruído com aparência de medida.
	it('declara como faltante o ativo com histórico curto', () => {
		const result = computeCorrelationMatrix({
			LONGO3: closesFrom(wave(40)),
			CURTO3: closesFrom(wave(MIN_OBSERVATIONS - 5)),
		});

		expect(result.missingSymbols).toEqual(['CURTO3']);
		expect(result.symbols).toEqual(['LONGO3']);
		expect(result.pairs).toEqual([]);
		expect(result.averageCorrelation).toBeNull();
	});

	it('devolve estado vazio sem ativos', () => {
		const result = computeCorrelationMatrix({});

		expect(result.symbols).toEqual([]);
		expect(result.matrix).toEqual([]);
		expect(result.highestPair).toBeNull();
		expect(result.lowestPair).toBeNull();
	});

	it('não inventa par mais descolado quando só há um par', () => {
		const base = wave(40);
		const result = computeCorrelationMatrix({
			AAAA3: closesFrom(base),
			BBBB3: closesFrom(base),
		});

		expect(result.highestPair).not.toBeNull();
		expect(result.lowestPair).toBeNull();
	});
});
