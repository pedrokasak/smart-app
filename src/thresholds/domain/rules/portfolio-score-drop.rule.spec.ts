import { SYSTEM_THRESHOLD_POLICY } from '../threshold-policy';
import { ThresholdStateSnapshot } from '../threshold.types';
import { PortfolioScoreDropRule } from './portfolio-score-drop.rule';

/** Queda minima 10 pontos, cooldown 72h, liberacao em 5 pontos. */
const policy = SYSTEM_THRESHOLD_POLICY;
const rule = new PortfolioScoreDropRule();

const T0 = new Date('2026-09-01T10:00:00.000Z');
const horas = (n: number) => new Date(T0.getTime() + n * 60 * 60 * 1000);

const estado = (
	over: Partial<ThresholdStateSnapshot> = {}
): ThresholdStateSnapshot => ({
	breaching: false,
	referenceValue: 80,
	lastNotifiedAt: null,
	lastEvaluatedAt: T0.toISOString(),
	...over,
});

describe('PortfolioScoreDropRule (TRA-136 fase 4)', () => {
	it('primeira leitura so grava a base e nao notifica', () => {
		const d = rule.evaluate({ score: 42, maxScore: 100 }, null, policy, T0);

		expect(d.outcome).toBe('suppressed_inside_band');
		expect(d.shouldNotify).toBe(false);
		expect(d.nextState?.referenceValue).toBe(42);
	});

	it('queda menor que o limiar nao notifica', () => {
		const d = rule.evaluate(
			{ score: 74, maxScore: 100 },
			estado(),
			policy,
			horas(24)
		);

		expect(d.shouldNotify).toBe(false);
		expect(d.nextState?.referenceValue).toBe(80);
	});

	it('queda de 10+ pontos contra a referencia notifica', () => {
		const d = rule.evaluate(
			{ score: 66, maxScore: 100 },
			estado(),
			policy,
			horas(24)
		);

		expect(d.outcome).toBe('notify');
		expect(d.metrics).toMatchObject({
			score: 66,
			previousScore: 80,
			dropPoints: 14,
		});
	});

	it('queda LENTA acumula: a referencia e o pico, nao a ultima leitura', () => {
		// 80 -> 77 -> 74 -> 71 -> 68: nenhum passo passa de 10 pontos, mas o
		// acumulado passa. Comparar so com a leitura anterior perderia isto.
		let state = estado();
		let ultima = rule.evaluate(
			{ score: 77, maxScore: 100 },
			state,
			policy,
			horas(24)
		);
		expect(ultima.shouldNotify).toBe(false);

		for (const [i, score] of [74, 71, 68].entries()) {
			state = ultima.nextState as ThresholdStateSnapshot;
			ultima = rule.evaluate(
				{ score, maxScore: 100 },
				state,
				policy,
				horas(48 + i * 24)
			);
		}

		expect(ultima.outcome).toBe('notify');
		expect(ultima.metrics.dropPoints).toBe(12);
	});

	it('condicao de pe nao repete dentro do cooldown', () => {
		const armado = estado({
			breaching: true,
			referenceValue: 80,
			lastNotifiedAt: T0.toISOString(),
		});

		const d = rule.evaluate(
			{ score: 66, maxScore: 100 },
			armado,
			policy,
			horas(24)
		);

		expect(d.outcome).toBe('suppressed_standing');
	});

	it('re-arma por cooldown depois de 72h com a queda de pe', () => {
		const armado = estado({
			breaching: true,
			referenceValue: 80,
			lastNotifiedAt: T0.toISOString(),
		});

		const d = rule.evaluate(
			{ score: 66, maxScore: 100 },
			armado,
			policy,
			horas(73)
		);

		expect(d.outcome).toBe('notify');
		expect(d.reason).toContain('cooldown');
	});

	it('recuperar desarma sem notificar e sobe a referencia', () => {
		const armado = estado({
			breaching: true,
			referenceValue: 80,
			lastNotifiedAt: T0.toISOString(),
		});

		const d = rule.evaluate(
			{ score: 84, maxScore: 100 },
			armado,
			policy,
			horas(30)
		);

		expect(d.outcome).toBe('cleared');
		expect(d.shouldNotify).toBe(false);
		expect(d.nextState).toMatchObject({
			breaching: false,
			referenceValue: 84,
			lastNotifiedAt: null,
		});
	});

	it('depois de desarmar, uma nova queda volta a ser borda de subida', () => {
		const desarmado = estado({ referenceValue: 84, lastNotifiedAt: null });

		const d = rule.evaluate(
			{ score: 70, maxScore: 100 },
			desarmado,
			policy,
			horas(40)
		);

		expect(d.outcome).toBe('notify');
		expect(d.reason).toContain('borda de subida');
	});

	it('leitura sem numero e descartada', () => {
		const d = rule.evaluate(
			{ score: Number.NaN, maxScore: 100 },
			estado(),
			policy,
			T0
		);

		expect(d.outcome).toBe('invalid');
		expect(d.nextState).toBeNull();
	});
});
