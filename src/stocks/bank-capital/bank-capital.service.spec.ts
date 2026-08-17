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
			.mockResolvedValueOnce({ basileia: null, imobilizacao: null }) // 202606
			.mockResolvedValueOnce({ basileia: 14.23, imobilizacao: 20.5 }); // 202603

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
			basileia: null,
			imobilizacao: null,
		});

		const result = await service.getIndicators('BBAS3');

		expect(mockFetchQuarterValues).toHaveBeenCalledTimes(4);
		expect(result).toBeNull();
	});

	it('aceita ausencia parcial — um indicador null nao impede o outro', async () => {
		mockFetchQuarterValues.mockResolvedValueOnce({
			basileia: 14.23,
			imobilizacao: null,
		});

		const result = await service.getIndicators('BBAS3');

		expect(result?.basileia).toBe(14.23);
		expect(result?.imobilizacao).toBeNull();
	});

	it('cacheia por simbolo e nao repete a chamada dentro de 24h', async () => {
		mockFetchQuarterValues.mockResolvedValueOnce({
			basileia: 14.23,
			imobilizacao: 20.5,
		});

		await service.getIndicators('BBAS3');
		mockFetchQuarterValues.mockClear();
		const second = await service.getIndicators('BBAS3');

		expect(mockFetchQuarterValues).not.toHaveBeenCalled();
		expect(second?.basileia).toBe(14.23);
	});
});
