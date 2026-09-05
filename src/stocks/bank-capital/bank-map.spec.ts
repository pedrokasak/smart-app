import { getBankEntry } from './bank-map';

describe('getBankEntry', () => {
	it('resolve BBAS3 para o Banco do Brasil', () => {
		expect(getBankEntry('BBAS3')).toEqual({
			symbol: 'BBAS3',
			bankName: 'Banco do Brasil',
			prudentialCode: 'C0080329',
		});
	});

	it('resolve os multiplos tickers de um mesmo banco para o mesmo codigo', () => {
		expect(getBankEntry('BBDC3')?.prudentialCode).toBe('C0080075');
		expect(getBankEntry('BBDC4')?.prudentialCode).toBe('C0080075');
	});

	it('BPAN4 e BPAC11 compartilham codigo prudencial, e isso e esperado', () => {
		expect(getBankEntry('BPAN4')?.prudentialCode).toBe(
			getBankEntry('BPAC11')?.prudentialCode
		);
		expect(getBankEntry('BPAN4')?.bankName).toBe('Banco Pan');
		expect(getBankEntry('BPAC11')?.bankName).toBe('BTG Pactual');
	});

	it('e insensivel a caixa e espaco nas pontas', () => {
		expect(getBankEntry(' bbas3 ')).toEqual({
			symbol: 'BBAS3',
			bankName: 'Banco do Brasil',
			prudentialCode: 'C0080329',
		});
	});

	it('devolve null para ativo fora da lista, sem lancar', () => {
		expect(getBankEntry('PETR4')).toBeNull();
		expect(getBankEntry('')).toBeNull();
		expect(getBankEntry(undefined as unknown as string)).toBeNull();
	});
});
