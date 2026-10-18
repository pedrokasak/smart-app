import {
	InvalidPolicyError,
	normalizePolicy,
	PORTFOLIO_PURPOSES,
	purposeOptions,
	suggestedPolicy,
} from './portfolio-policy';

describe('portfolio policy (TRA-106)', () => {
	it('sugere a política do handoff para cada finalidade', () => {
		expect(suggestedPolicy('income')).toEqual({
			targets: [
				{ key: 'fiis', label: 'FIIs', pct: 40 },
				{ key: 'dividend_stocks', label: 'Ações pagadoras', pct: 30 },
				{ key: 'fixed_income', label: 'Renda fixa', pct: 25 },
			],
			maxPositionPct: 8,
		});
		expect(suggestedPolicy('speculative').maxPositionPct).toBe(20);
		expect(suggestedPolicy('reserve').targets[0]).toEqual({
			key: 'daily_liquidity',
			label: 'Liquidez diária',
			pct: 85,
		});
	});

	it('toda sugestão é uma política válida', () => {
		for (const purpose of PORTFOLIO_PURPOSES) {
			expect(() => normalizePolicy(suggestedPolicy(purpose))).not.toThrow();
		}
	});

	it('devolve cópia: alterar o retorno não muda a tabela', () => {
		suggestedPolicy('income').targets[0].pct = 99;
		expect(suggestedPolicy('income').targets[0].pct).toBe(40);
	});

	it('lista as quatro finalidades na ordem do handoff', () => {
		expect(purposeOptions().map((option) => option.label)).toEqual([
			'Longo prazo',
			'Renda',
			'Especulativa',
			'Reserva',
		]);
	});

	describe('normalizePolicy', () => {
		const target = (key: string, pct: number) => ({ key, label: key, pct });

		it('aceita soma abaixo de 100 e tolera arredondamento', () => {
			expect(
				normalizePolicy({
					targets: [
						target('a', 33.33),
						target('b', 33.33),
						target('c', 33.344),
					],
					maxPositionPct: 10,
				}).targets.map((t) => t.pct)
			).toEqual([33.33, 33.33, 33.34]);
		});

		it('recusa soma acima de 100%', () => {
			expect(() =>
				normalizePolicy({
					targets: [target('a', 60), target('b', 41)],
					maxPositionPct: 10,
				})
			).toThrow(InvalidPolicyError);
		});

		it('recusa classe repetida, lista vazia e metas demais', () => {
			expect(() =>
				normalizePolicy({
					targets: [target('a', 10), target(' a ', 10)],
					maxPositionPct: 10,
				})
			).toThrow('uma vez só');
			expect(() =>
				normalizePolicy({ targets: [], maxPositionPct: 10 })
			).toThrow(InvalidPolicyError);
			expect(() =>
				normalizePolicy({
					targets: Array.from({ length: 9 }, (_, i) => target(`k${i}`, 1)),
					maxPositionPct: 10,
				})
			).toThrow(InvalidPolicyError);
		});
	});
});
