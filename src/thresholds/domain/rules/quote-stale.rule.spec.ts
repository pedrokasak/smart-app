import { SYSTEM_THRESHOLD_POLICY } from '../threshold-policy';
import { ThresholdStateSnapshot } from '../threshold.types';
import { QuoteStaleRule } from './quote-stale.rule';

/**
 * O que estes testes fixam nao e "a regra compara dois numeros" — e o
 * motivo de o `market.quote.stale` ter deixado de ser discreto: a mesma
 * fonte parada por uma semana pode render UM aviso, nao sete.
 */
describe('QuoteStaleRule (TRA-136, fase 7)', () => {
	const rule = new QuoteStaleRule();
	const policy = SYSTEM_THRESHOLD_POLICY; // 1440 min de corte, 72h cooldown
	const T0 = new Date('2026-03-02T09:00:00.000Z');

	const lastQuote = (iso: string) => new Date(iso).getTime();
	const at = (horas: number) => new Date(T0.getTime() + horas * 60 * 60 * 1000);

	function entrada(minutos: number, ultimaLeituraIso: string) {
		return {
			symbol: 'petr4',
			minutesSinceLastQuote: minutos,
			lastQuoteAtMs: lastQuote(ultimaLeituraIso),
		};
	}

	function estado(
		parcial: Partial<ThresholdStateSnapshot> & { referenceValue: number }
	): ThresholdStateSnapshot {
		return {
			breaching: true,
			lastNotifiedAt: T0.toISOString(),
			lastEvaluatedAt: T0.toISOString(),
			...parcial,
		};
	}

	it('normaliza o simbolo no escopo — PETR4 e petr4 sao a mesma condicao', () => {
		expect(rule.scopeOf(entrada(2000, '2026-03-01T00:00:00.000Z'))).toBe(
			'PETR4'
		);
	});

	it('borda de subida: primeiro silencio acima do corte notifica', () => {
		const d = rule.evaluate(
			entrada(1500, '2026-03-01T08:00:00.000Z'),
			null,
			policy,
			T0
		);

		expect(d.outcome).toBe('notify');
		expect(d.shouldNotify).toBe(true);
		expect(d.scope).toBe('PETR4');
		expect(d.metrics.minutesSinceLastQuote).toBe(1500);
		expect(d.metrics.staleAfterMinutes).toBe(1440);
	});

	it('mesmo episodio, dentro do cooldown: cala', () => {
		const ultima = '2026-03-01T08:00:00.000Z';
		const d = rule.evaluate(
			entrada(1560, ultima),
			estado({ referenceValue: lastQuote(ultima) }),
			policy,
			at(1)
		);

		expect(d.outcome).toBe('suppressed_standing');
		expect(d.shouldNotify).toBe(false);
	});

	it('uma semana parada nao vira um aviso por dia', () => {
		const ultima = '2026-03-01T08:00:00.000Z';
		let anterior: ThresholdStateSnapshot | null = null;
		const avisos: number[] = [];

		// Uma avaliacao por dia, sete dias, sempre o MESMO episodio.
		for (let dia = 1; dia <= 7; dia += 1) {
			const agora = at(24 * dia);
			const minutos = Math.floor(
				(agora.getTime() - lastQuote(ultima)) / 60_000
			);
			const d = rule.evaluate(
				entrada(minutos, ultima),
				anterior,
				policy,
				agora
			);
			if (d.shouldNotify) avisos.push(dia);
			anterior = d.nextState;
		}

		// Um aviso na borda + re-arme a cada 72h: nunca sete.
		expect(avisos.length).toBeLessThanOrEqual(3);
		expect(avisos[0]).toBe(1);
	});

	it('re-arme por cooldown: passadas 72h de pe, avisa de novo uma vez', () => {
		const ultima = '2026-03-01T08:00:00.000Z';
		const d = rule.evaluate(
			entrada(1440 + 72 * 60, ultima),
			estado({ referenceValue: lastQuote(ultima) }),
			policy,
			at(72)
		);

		expect(d.outcome).toBe('notify');
		expect(d.reason).toContain('cooldown');
	});

	/**
	 * O caso que so existe porque o produtor nunca publica leitura fresca:
	 * sem a identidade do episodio, o estado ficaria armado para sempre e o
	 * segundo silencio, dias depois, seria engolido como "ja avisado".
	 */
	it('carimbo mais novo = episodio novo: volta a ser borda de subida', () => {
		const anterior = estado({
			referenceValue: lastQuote('2026-03-01T08:00:00.000Z'),
			lastNotifiedAt: T0.toISOString(),
		});

		const novaUltima = '2026-03-03T08:00:00.000Z'; // houve leitura no meio
		const d = rule.evaluate(
			entrada(1500, novaUltima),
			anterior,
			policy,
			at(48)
		);

		expect(d.outcome).toBe('notify');
		expect(d.reason).toContain('episodio novo');
		expect(d.nextState?.referenceValue).toBe(lastQuote(novaUltima));
	});

	it('leitura sem simbolo ou com idade negativa e descartada', () => {
		const semSimbolo = rule.evaluate(
			{ ...entrada(1500, '2026-03-01T08:00:00.000Z'), symbol: '  ' },
			null,
			policy,
			T0
		);
		expect(semSimbolo.outcome).toBe('invalid');
		expect(semSimbolo.nextState).toBeNull();

		const idadeNegativa = rule.evaluate(
			entrada(-5, '2026-03-01T08:00:00.000Z'),
			null,
			policy,
			T0
		);
		expect(idadeNegativa.outcome).toBe('invalid');
	});

	it('evidencia carrega simbolo, ultima leitura e o limite aplicado', () => {
		const d = rule.evaluate(
			entrada(2880, '2026-02-28T09:00:00.000Z'),
			null,
			policy,
			T0
		);

		expect(d.evidence.map((e) => e.source)).toEqual([
			'quote.symbol',
			'quote.lastQuoteAt',
			'quote.hoursSinceLastQuote',
			'threshold.quoteStaleAfterMinutes',
		]);
		expect(d.metrics.hoursSinceLastQuote).toBe(48);
	});
});
