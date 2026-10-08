import { createHash } from 'node:crypto';
import { buildZip } from 'src/common/zip/zip-builder.fixture';
import {
	CVM_BASE_URL,
	CvmDownloadTooLargeError,
	CvmInvestmentFundSource,
	LIMITS,
} from './cvm-investment-fund.source';
import { INFORME_DIARIO_HEADER } from './informe-diario.parser';

const informe = [
	INFORME_DIARIO_HEADER.join(';'),
	'CLASSES - FIF;00.017.024/0001-53;;2026-09-01;1107741.39;44.636723400000;1214792.63;0.00;0.00;1',
	'CLASSES - FIF;00.017.024/0001-53;;2026-09-02;1108302.04;44.655755500000;1215310.59;0.00;0.00;1',
].join('\r\n');

const CLASS_HEADER =
	'ID_Registro_Fundo;ID_Registro_Classe;CNPJ_Classe;Tipo_Classe;Denominacao_Social;Situacao;Classificacao;Forma_Condominio;Exclusivo;Publico_Alvo';
const registryClasses = [
	CLASS_HEADER,
	'1;82;00017024000153;Classes de Cotas de Fundos FIF;FUNDO AÇÕES EXEMPLO;Em Funcionamento Normal;Ações;Aberto;N;Público Geral',
].join('\r\n');

function response(body: Buffer | null, status = 200) {
	return new Response(body ? new Uint8Array(body) : null, { status });
}

function sourceReturning(body: Buffer | null, status = 200) {
	const source = new CvmInvestmentFundSource();
	const fetchImpl = jest.fn(async () => response(body, status));
	source.fetchImpl = fetchImpl as unknown as typeof fetch;
	return { source, fetchImpl };
}

describe('CvmInvestmentFundSource', () => {
	const dailyZip = buildZip([
		{ name: 'inf_diario_fi_202609.csv', content: informe },
	]);

	it('reads the monthly Informe Diário and keeps the latest quote', async () => {
		const { source, fetchImpl } = sourceReturning(dailyZip);

		const read = await source.fetchDailyReport('202609');

		expect(fetchImpl).toHaveBeenCalledWith(
			`${CVM_BASE_URL}/DOC/INF_DIARIO/DADOS/inf_diario_fi_202609.zip`,
			expect.anything()
		);
		expect(read).toMatchObject({
			status: 'parsed',
			sha256: createHash('sha256').update(dailyZip).digest('hex'),
			data: {
				rows: 2,
				invalidRows: 0,
				latestDate: '2026-09-02',
				quotes: [
					expect.objectContaining({
						cnpj: '00017024000153',
						date: '2026-09-02',
						quota: 44.6557555,
					}),
				],
			},
		});
	});

	it('skips parsing when the file hash did not change', async () => {
		const { source } = sourceReturning(dailyZip);
		const sha = createHash('sha256').update(dailyZip).digest('hex');

		await expect(source.fetchDailyReport('202609', sha)).resolves.toEqual({
			status: 'unchanged',
			sourceUrl: expect.stringContaining('inf_diario_fi_202609.zip'),
			sha256: sha,
		});
	});

	it('reports a month that is not published yet as missing', async () => {
		const { source } = sourceReturning(null, 404);

		await expect(source.fetchDailyReport('202611')).resolves.toMatchObject({
			status: 'missing',
		});
	});

	it('fails on other HTTP errors', async () => {
		const { source } = sourceReturning(null, 503);

		await expect(source.fetchDailyReport('202609')).rejects.toThrow('HTTP 503');
	});

	it('fails when the CSV is not inside the zip', async () => {
		const { source } = sourceReturning(
			buildZip([{ name: 'outro.csv', content: 'x' }])
		);

		await expect(source.fetchDailyReport('202609')).rejects.toThrow(
			'não está no zip'
		);
	});

	it('refuses an invalid competence before any request', async () => {
		const { source, fetchImpl } = sourceReturning(dailyZip);

		await expect(source.fetchDailyReport('2026-09')).rejects.toThrow(
			'Competência inválida'
		);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('stops a download over the size limit', async () => {
		const { source } = sourceReturning(Buffer.alloc(LIMITS.dailyZipBytes + 1));

		await expect(source.fetchDailyReport('202609')).rejects.toBeInstanceOf(
			CvmDownloadTooLargeError
		);
	});

	it('reads the registry with ISO-8859-1 names', async () => {
		const { source, fetchImpl } = sourceReturning(
			buildZip([
				{
					name: 'registro_classe.csv',
					content: Buffer.from(registryClasses, 'latin1'),
				},
			])
		);

		const read = await source.fetchRegistry();

		expect(fetchImpl).toHaveBeenCalledWith(
			`${CVM_BASE_URL}/CAD/DADOS/registro_fundo_classe.zip`,
			expect.anything()
		);
		expect(read).toMatchObject({
			status: 'parsed',
			data: [
				{
					cnpj: '00017024000153',
					name: 'FUNDO AÇÕES EXEMPLO',
					classification: 'Ações',
					subclasses: [],
				},
			],
		});
	});
});
