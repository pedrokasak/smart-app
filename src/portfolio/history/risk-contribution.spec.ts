import { MIN_OBSERVATIONS } from './benchmark-metrics';
import { computeRiskContribution } from './risk-contribution';

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

const closesFrom = (returns: number[]) => {
	const days = businessDays(returns.length + 1);
	let price = 100;
	const out = [{ date: days[0], close: price }];
	returns.forEach((r, i) => {
		price *= 1 + r;
		out.push({ date: days[i + 1], close: price });
	});
	return out;
};

const wave = (n: number, amplitude: number, phase = 0) =>
	Array.from({ length: n }, (_, i) =>
		(i + phase) % 2 === 0 ? amplitude : -amplitude * 0.9
	);

describe('computeRiskContribution', () => {
	it('as fatias somam 100%', () => {
		const result = computeRiskContribution({
			positions: [
				{ symbol: 'AAAA3', marketValue: 5000 },
				{ symbol: 'BBBB3', marketValue: 3000 },
				{ symbol: 'CCCC3', marketValue: 2000 },
			],
			closesBySymbol: {
				AAAA3: closesFrom(wave(60, 0.01)),
				BBBB3: closesFrom(wave(60, 0.02)),
				CCCC3: closesFrom(wave(60, 0.005, 1)),
			},
		});

		const total = result.rows.reduce((sum, row) => sum + row.sharePct, 0);
		expect(total).toBeCloseTo(100, 0);
		expect(result.observations).toBe(60);
	});

	// O ponto do card: risco pode ser o dobro do peso.
	it('ativo mais volátil pesa mais no risco do que no valor', () => {
		const result = computeRiskContribution({
			positions: [
				{ symbol: 'CALMO3', marketValue: 8000 },
				{ symbol: 'NERVO3', marketValue: 2000 },
			],
			closesBySymbol: {
				CALMO3: closesFrom(wave(60, 0.005)),
				NERVO3: closesFrom(wave(60, 0.05)),
			},
		});

		const nervous = result.rows.find((row) => row.symbol === 'NERVO3');
		expect(nervous?.weightPct).toBe(20);
		expect(nervous?.sharePct).toBeGreaterThan(40);
		expect(result.rows[0].symbol).toBe('NERVO3');
	});

	it('declara ativo sem histórico e quanto do valor ficou de fora', () => {
		const result = computeRiskContribution({
			positions: [
				{ symbol: 'AAAA3', marketValue: 4000 },
				{ symbol: 'BBBB3', marketValue: 4000 },
				{ symbol: 'BTC', marketValue: 2000 },
			],
			closesBySymbol: {
				AAAA3: closesFrom(wave(60, 0.01)),
				BBBB3: closesFrom(wave(60, 0.02, 1)),
			},
		});

		expect(result.missingSymbols).toEqual(['BTC']);
		expect(result.excludedValuePct).toBe(20);
		expect(result.rows.map((row) => row.weightPct)).toEqual([50, 50]);
	});

	// Pareamento por data: dia que falta num ativo sai de todos.
	it('usa só as datas comuns a todas as séries', () => {
		const full = closesFrom(wave(60, 0.01));
		const result = computeRiskContribution({
			positions: [
				{ symbol: 'AAAA3', marketValue: 5000 },
				{ symbol: 'BBBB3', marketValue: 5000 },
			],
			closesBySymbol: {
				AAAA3: full,
				BBBB3: closesFrom(wave(60, 0.02)).filter((_, i) => i !== 30),
			},
		});

		// Sem o fechamento do dia 30, BBBB3 perde o retorno desse dia.
		expect(result.observations).toBe(59);
	});

	it('não decompõe com um ativo só ou histórico curto', () => {
		expect(
			computeRiskContribution({
				positions: [{ symbol: 'AAAA3', marketValue: 1000 }],
				closesBySymbol: { AAAA3: closesFrom(wave(60, 0.01)) },
			}).rows
		).toEqual([]);

		expect(
			computeRiskContribution({
				positions: [
					{ symbol: 'AAAA3', marketValue: 1000 },
					{ symbol: 'BBBB3', marketValue: 1000 },
				],
				closesBySymbol: {
					AAAA3: closesFrom(wave(MIN_OBSERVATIONS - 5, 0.01)),
					BBBB3: closesFrom(wave(MIN_OBSERVATIONS - 5, 0.02)),
				},
			}).rows
		).toEqual([]);
	});
});
