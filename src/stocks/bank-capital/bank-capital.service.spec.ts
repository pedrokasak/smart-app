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
		);
		expect(mockFetchQuarterValues).toHaveBeenNthCalledWith(
			2,
			'C0080329',
			'202603',
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
	it('desiste dentro do orcamento quando cada trimestre e lento sem estourar o timeout de 8s (I2)', async () => {
		const startedAt = Date.now();
		mockFetchQuarterValues.mockImplementation(async () => {
			jest.setSystemTime(new Date(Date.now() + 4000)); // 4s por fetch
			return { ok: true, basileia: null, imobilizacao: null };
		});

		const result = await service.getIndicators('BBAS3');

		expect(result).toBeNull();
		expect(mockFetchQuarterValues.mock.calls.length).toBeLessThan(4);
		expect(Date.now() - startedAt).toBeLessThanOrEqual(10_000);
	});
});
