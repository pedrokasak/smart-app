import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { CvmFiiRegistryAdapter } from 'src/ri-intelligence/watch/infrastructure/cvm-fii-registry.adapter';

const YEAR = new Date().getUTCFullYear();
const HEADER = 'CNPJ_Fundo_Classe;Data_Referencia;Codigo_ISIN';

/** Troca o unzip por um CSV por ano, sem montar zip real. */
class TestableRegistry extends CvmFiiRegistryAdapter {
	constructor(
		httpService: HttpService,
		private readonly csvByYear: Record<number, string>
	) {
		super(httpService);
	}

	protected async extractCsv(_buffer: Buffer, year: number): Promise<string> {
		return this.csvByYear[year] ?? '';
	}
}

describe('CvmFiiRegistryAdapter (TRA-266)', () => {
	let httpService: { get: jest.Mock };

	beforeEach(() => {
		httpService = {
			get: jest.fn().mockReturnValue(of({ data: new ArrayBuffer(0) })),
		};
	});

	const make = (csvByYear: Record<number, string>) =>
		new TestableRegistry(httpService as unknown as HttpService, csvByYear);

	it('resolves a FII ticker to the fund CNPJ', async () => {
		const registry = make({
			[YEAR]: `${HEADER}\n11.728.688/0001-47;${YEAR}-08-01;BRHGLGCTF004`,
		});

		await expect(registry.resolveFundCnpj('HGLG11')).resolves.toBe(
			'11728688000147'
		);
		await expect(registry.resolveFundCnpj('hglg11.sa')).resolves.toBe(
			'11728688000147'
		);
	});

	it('returns null for an unknown fund or a malformed ticker', async () => {
		const registry = make({
			[YEAR]: `${HEADER}\n11.728.688/0001-47;${YEAR}-08-01;BRHGLGCTF004`,
		});

		await expect(registry.resolveFundCnpj('XPTO11')).resolves.toBeNull();
		await expect(registry.resolveFundCnpj('HGLG')).resolves.toBeNull();
	});

	// Janeiro: o arquivo do ano novo ainda esta vazio.
	it('falls back to the previous year, with the current one taking over', async () => {
		const registry = make({
			[YEAR - 1]:
				`${HEADER}\n11.111.111/0001-11;${YEAR - 1}-11-01;BRABCDCTF001\n` +
				`33.333.333/0001-33;${YEAR - 1}-11-01;BROLDXCTF001`,
			[YEAR]: `${HEADER}\n22.222.222/0001-22;${YEAR}-01-01;BRABCDCTF001`,
		});

		await expect(registry.resolveFundCnpj('ABCD11')).resolves.toBe(
			'22222222000122'
		);
		await expect(registry.resolveFundCnpj('OLDX11')).resolves.toBe(
			'33333333000133'
		);
		expect(httpService.get.mock.calls.map(([url]) => url)).toEqual([
			`${CvmFiiRegistryAdapter.BASE_URL}/inf_mensal_fii_${YEAR - 1}.zip`,
			`${CvmFiiRegistryAdapter.BASE_URL}/inf_mensal_fii_${YEAR}.zip`,
		]);
	});

	it('keeps working when one of the years fails to download', async () => {
		httpService.get
			.mockReturnValueOnce(throwError(() => new Error('404')))
			.mockReturnValueOnce(of({ data: new ArrayBuffer(0) }));
		const registry = make({
			[YEAR]: `${HEADER}\n11.728.688/0001-47;${YEAR}-08-01;BRHGLGCTF004`,
		});

		await expect(registry.resolveFundCnpj('HGLG11')).resolves.toBe(
			'11728688000147'
		);
	});

	it('downloads once a day, not once per ticker', async () => {
		const registry = make({
			[YEAR]: `${HEADER}\n11.728.688/0001-47;${YEAR}-08-01;BRHGLGCTF004`,
		});

		await Promise.all([
			registry.resolveFundCnpj('HGLG11'),
			registry.resolveFundCnpj('KNRI11'),
		]);
		await registry.resolveFundCnpj('HGLG11');

		expect(httpService.get).toHaveBeenCalledTimes(2);
	});

	// Sem cadastro, o vigia tira os FIIs da rodada — e tenta de novo depois.
	it('fails without caching when no year is available', async () => {
		httpService.get.mockReturnValue(throwError(() => new Error('cvm fora')));
		const registry = make({});

		await expect(registry.resolveFundCnpj('HGLG11')).rejects.toThrow(
			'cvm_fii_registry_unavailable'
		);

		httpService.get.mockReturnValue(of({ data: new ArrayBuffer(0) }));
		(registry as unknown as { csvByYear: Record<number, string> }).csvByYear[
			YEAR
		] = `${HEADER}\n11.728.688/0001-47;${YEAR}-08-01;BRHGLGCTF004`;

		await expect(registry.resolveFundCnpj('HGLG11')).resolves.toBe(
			'11728688000147'
		);
	});
});
