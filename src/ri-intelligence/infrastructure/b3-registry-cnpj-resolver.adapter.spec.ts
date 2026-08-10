import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { B3RegistryCnpjResolverAdapter } from './b3-registry-cnpj-resolver.adapter';

// Formato confirmado ao vivo em 2026-08-10 contra
// https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall/GetInitialCompanies/<base64>
// `issuingCompany` é o código-base do emissor (sem o dígito de espécie do
// ticker) e `cnpj` vem sem zeros à esquerda.
function singlePageResponse(rows: any[]) {
	return {
		data: {
			page: { pageNumber: 1, pageSize: 120, totalRecords: rows.length, totalPages: 1 },
			results: rows,
		},
	};
}

describe('B3RegistryCnpjResolverAdapter', () => {
	function buildAdapter(getImpl: () => any) {
		const httpService = { get: jest.fn(getImpl) } as unknown as HttpService;
		return new B3RegistryCnpjResolverAdapter(httpService);
	}

	it('resolves a CNPJ for a ticker present in the B3 registry response', async () => {
		const adapter = buildAdapter(() =>
			of(
				singlePageResponse([
					{
						codeCVM: '9512',
						issuingCompany: 'ABCD',
						companyName: 'Empresa Real S.A.',
						tradingName: 'EMPRESA REAL',
						cnpj: '3987364000103',
					},
				])
			)
		);
		const result = await adapter.resolveCnpj('ABCD3');
		expect(result).toEqual({ cnpj: '03987364000103', company: 'Empresa Real S.A.' });
	});

	it('returns null when the ticker is not found in the registry', async () => {
		const adapter = buildAdapter(() => of(singlePageResponse([])));
		const result = await adapter.resolveCnpj('ZZZZ9');
		expect(result).toBeNull();
	});

	it('returns null and does not throw when the request fails', async () => {
		const adapter = buildAdapter(() => throwError(() => new Error('network down')));
		await expect(adapter.resolveCnpj('ABCD3')).resolves.toBeNull();
	});

	it('caches the full registry across calls (single network call for two lookups)', async () => {
		const getMock = jest.fn(() =>
			of(
				singlePageResponse([
					{
						codeCVM: '1',
						issuingCompany: 'AAAA',
						companyName: 'X',
						cnpj: '11111111000111',
					},
				])
			)
		);
		const adapter = buildAdapter(getMock);
		await adapter.resolveCnpj('AAAA3');
		await adapter.resolveCnpj('AAAA3');
		expect(getMock).toHaveBeenCalledTimes(1);
	});

	it('matches the ticker by stripping the trailing security-class digit(s)', async () => {
		const adapter = buildAdapter(() =>
			of(
				singlePageResponse([
					{
						codeCVM: '9512',
						issuingCompany: 'PETR',
						companyName: 'PETROLEO BRASILEIRO S.A. PETROBRAS',
						cnpj: '33000167000101',
					},
				])
			)
		);
		expect(await adapter.resolveCnpj('petr4')).toEqual({
			cnpj: '33000167000101',
			company: 'PETROLEO BRASILEIRO S.A. PETROBRAS',
		});
	});

	it('fetches subsequent pages when the registry spans more than one page', async () => {
		const page1 = {
			data: {
				page: { pageNumber: 1, pageSize: 120, totalRecords: 2, totalPages: 2 },
				results: [
					{ codeCVM: '1', issuingCompany: 'AAAA', companyName: 'A Co', cnpj: '11111111000111' },
				],
			},
		};
		const page2 = {
			data: {
				page: { pageNumber: 2, pageSize: 120, totalRecords: 2, totalPages: 2 },
				results: [
					{ codeCVM: '2', issuingCompany: 'BBBB', companyName: 'B Co', cnpj: '22222222000122' },
				],
			},
		};
		const getMock = jest.fn().mockReturnValueOnce(of(page1)).mockReturnValueOnce(of(page2));
		const adapter = buildAdapter(getMock);

		const result = await adapter.resolveCnpj('BBBB3');

		expect(getMock).toHaveBeenCalledTimes(2);
		expect(result).toEqual({ cnpj: '22222222000122', company: 'B Co' });
	});

	it('skips rows missing a usable cnpj or company name', async () => {
		const adapter = buildAdapter(() =>
			of(
				singlePageResponse([
					{ codeCVM: '1', issuingCompany: 'CCCC', companyName: 'C Co', cnpj: '0' },
					{ codeCVM: '2', issuingCompany: 'DDDD', companyName: '', cnpj: '33333333000133' },
				])
			)
		);
		expect(await adapter.resolveCnpj('CCCC3')).toBeNull();
		expect(await adapter.resolveCnpj('DDDD3')).toBeNull();
	});
});
