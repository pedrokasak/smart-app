import { BankCapitalService } from './bank-capital.service';
import * as bcbClient from './bcb-if-data.client';

jest.mock('./bcb-if-data.client');
const mockFetchQuarterValues = bcbClient.fetchQuarterValues as jest.Mock;

describe('BankCapitalService', () => {
	let service: BankCapitalService;

	beforeEach(() => {
		service = new BankCapitalService();
		(BankCapitalService as any).cache?.clear?.();
		mockFetchQuarterValues.mockReset();
		jest.useFakeTimers().setSystemTime(new Date('2026-08-16T12:00:00Z'));
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('devolve null para simbolo fora da lista fixa, sem chamar a rede', async () => {
		const result = await service.getIndicators('PETR4');
		expect(result).toBeNull();
		expect(mockFetchQuarterValues).not.toHaveBeenCalled();
	});

	it('recua um trimestre quando o mais recente calculado ainda nao foi publicado', async () => {
		mockFetchQuarterValues
			.mockResolvedValueOnce({ ok: true, basileia: null, imobilizacao: null }) // 202606
			.mockResolvedValueOnce({ ok: true, basileia: 14.23, imobilizacao: 20.5 }); // 202603

		const result = await service.getIndicators('BBAS3');

		expect(mockFetchQuarterValues).toHaveBeenNthCalledWith(
			1,
			'C0080329',
			'202606',
			8000,
		);
		expect(mockFetchQuarterValues).toHaveBeenNthCalledWith(
			2,
			'C0080329',
			'202603',
			8000,
		);
		expect(result).toEqual({
			symbol: 'BBAS3',
			bankName: 'Banco do Brasil',
			period: '2026-03',
			basileia: 14.23,
			imobilizacao: 20.5,
		});
	});

	it('para apos 4 tentativas e devolve null', async () => {
		mockFetchQuarterValues.mockResolvedValue({
			ok: true,
			basileia: null,
			imobilizacao: null,
		});

		const result = await service.getIndicators('BBAS3');

		expect(mockFetchQuarterValues).toHaveBeenCalledTimes(4);
		expect(result).toBeNull();
	});

	it('aceita ausencia parcial — um indicador null nao impede o outro', async () => {
		mockFetchQuarterValues.mockResolvedValueOnce({
			ok: true,
			basileia: 14.23,
			imobilizacao: null,
		});

		const result = await service.getIndicators('BBAS3');

		expect(result?.basileia).toBe(14.23);
		expect(result?.imobilizacao).toBeNull();
	});

	it('cacheia por simbolo e nao repete a chamada dentro de 24h', async () => {
		mockFetchQuarterValues.mockResolvedValueOnce({
			ok: true,
			basileia: 14.23,
			imobilizacao: 20.5,
		});

		await service.getIndicators('BBAS3');
		mockFetchQuarterValues.mockClear();
		const second = await service.getIndicators('BBAS3');

		expect(mockFetchQuarterValues).not.toHaveBeenCalled();
		expect(second?.basileia).toBe(14.23);
	});

	// I1: uma indisponibilidade transitoria do BCB nao pode congelar o simbolo
	// em null por 24h como faz a ausencia legitima de publicacao.
	describe('cache de falha transitoria (I1)', () => {
		it('mantem o null por 24h quando as 4 tentativas responderam e realmente nao ha dado', async () => {
			mockFetchQuarterValues.mockResolvedValue({
				ok: true,
				basileia: null,
				imobilizacao: null,
			});

			expect(await service.getIndicators('BBAS3')).toBeNull();
			expect(mockFetchQuarterValues).toHaveBeenCalledTimes(4);

			mockFetchQuarterValues.mockClear();
			jest.setSystemTime(new Date('2026-08-16T12:30:00Z')); // +30min
			expect(await service.getIndicators('BBAS3')).toBeNull();
			expect(mockFetchQuarterValues).not.toHaveBeenCalled();
		});

		it('NAO cacheia por 24h quando o fetch falhou (ok=false): meia hora depois ja tenta de novo e devolve o dado vivo', async () => {
			mockFetchQuarterValues.mockResolvedValue({
				ok: false,
				basileia: null,
				imobilizacao: null,
			});

			expect(await service.getIndicators('BBAS3')).toBeNull();

			mockFetchQuarterValues.mockReset();
			mockFetchQuarterValues.mockResolvedValue({
				ok: true,
				basileia: 14.23,
				imobilizacao: 20.5,
			});
			jest.setSystemTime(new Date('2026-08-16T12:30:00Z')); // +30min

			const second = await service.getIndicators('BBAS3');
			expect(mockFetchQuarterValues).toHaveBeenCalled();
			expect(second?.basileia).toBe(14.23);
		});

		it('segura a repeticao da falha transitoria por alguns minutos (nao martela o BCB a cada request)', async () => {
			mockFetchQuarterValues.mockResolvedValue({
				ok: false,
				basileia: null,
				imobilizacao: null,
			});

			await service.getIndicators('BBAS3');
			mockFetchQuarterValues.mockClear();
			jest.setSystemTime(new Date('2026-08-16T12:01:00Z')); // +1min

			expect(await service.getIndicators('BBAS3')).toBeNull();
			expect(mockFetchQuarterValues).not.toHaveBeenCalled();
		});
	});

	// I2: teto de relogio sobre a caminhada inteira, nao so por fetch.
	describe('orcamento de relogio da caminhada (I2)', () => {
		/**
		 * Simula uma latencia fixa por trimestre. O fetch respeita o timeout que
		 * recebeu: se o resto do orcamento for menor que a latencia, a chamada
		 * aborta no timeout em vez de estourar o teto.
		 */
		function withLatency(latencyMs: number) {
			mockFetchQuarterValues.mockImplementation(
				async (_code: string, _anoMes: string, timeoutMs: number) => {
					jest.setSystemTime(
						new Date(Date.now() + Math.min(latencyMs, timeoutMs)),
					);
					return { ok: true, basileia: null, imobilizacao: null };
				},
			);
		}

		// Regressao do bug de aritmetica: somar FETCH_TIMEOUT_MS inteiro ao
		// tempo decorrido antes de comparar com o teto encurtava o orcamento de
		// 10s para 2s uteis, e a caminhada desistia no 2o/3o trimestre com
		// qualquer latencia acima de ~660ms.
		it.each([500, 700, 1000, 2000])(
			'usa as 4 tentativas com %ims por trimestre — o orcamento de 10s vale 10s, nao 2s',
			async (latency) => {
				const startedAt = Date.now();
				withLatency(latency);

				const result = await service.getIndicators('BBAS3');

				expect(result).toBeNull();
				expect(mockFetchQuarterValues).toHaveBeenCalledTimes(4);
				expect(Date.now() - startedAt).toBeLessThanOrEqual(10_000);
			},
		);

		it('mantem o cache de 24h quando as 4 tentativas couberam no orcamento (nao vira transitorio)', async () => {
			withLatency(2000);

			expect(await service.getIndicators('BBAS3')).toBeNull();
			expect(mockFetchQuarterValues).toHaveBeenCalledTimes(4);

			mockFetchQuarterValues.mockClear();
			jest.setSystemTime(new Date('2026-08-16T12:30:00Z')); // +30min
			expect(await service.getIndicators('BBAS3')).toBeNull();
			expect(mockFetchQuarterValues).not.toHaveBeenCalled();
		});

		it('corta a caminhada quando o trimestre e lento demais, sem ultrapassar o teto', async () => {
			const startedAt = Date.now();
			withLatency(5000);

			const result = await service.getIndicators('BBAS3');

			expect(result).toBeNull();
			expect(mockFetchQuarterValues.mock.calls.length).toBeLessThan(4);
			expect(Date.now() - startedAt).toBeLessThanOrEqual(10_000);
		});

		it('nao ultrapassa o teto quando o trimestre estoura o timeout por fetch', async () => {
			const startedAt = Date.now();
			withLatency(9000); // acima do teto de 8s por fetch

			await service.getIndicators('BBAS3');

			// 8000 (1o fetch, cortado pelo teto por fetch) + 2000 (resto do
			// orcamento). Sem o timeout por chamada, o 2o fetch levaria 8s e a
			// caminhada terminaria em 16s, estourando o teto de 10s.
			expect(Date.now() - startedAt).toBeLessThanOrEqual(10_000);
		});

		it('da ao ultimo fetch o resto do orcamento como timeout, em vez de recusar a tentativa', async () => {
			withLatency(5000);

			await service.getIndicators('BBAS3');

			// 1a chamada: orcamento inteiro, limitado pelo teto por fetch.
			expect(mockFetchQuarterValues.mock.calls[0][2]).toBe(8000);
			// 2a: sobraram 5s do orcamento, entao o fetch recebe 5s, nao 8s.
			expect(mockFetchQuarterValues.mock.calls[1][2]).toBe(5000);
		});

		// Interlock da rodada anterior: caminhada cortada pelo orcamento nao
		// prova ausencia de dado, entao continua com o cache curto de 3min.
		it('classifica a caminhada esgotada pelo orcamento como transitoria (cache curto, nao 24h)', async () => {
			withLatency(5000);

			expect(await service.getIndicators('BBAS3')).toBeNull();

			mockFetchQuarterValues.mockReset();
			mockFetchQuarterValues.mockResolvedValue({
				ok: true,
				basileia: 14.23,
				imobilizacao: 20.5,
			});
			jest.setSystemTime(new Date('2026-08-16T12:30:00Z')); // +30min

			const second = await service.getIndicators('BBAS3');
			expect(mockFetchQuarterValues).toHaveBeenCalled();
			expect(second?.basileia).toBe(14.23);
		});
	});
});
