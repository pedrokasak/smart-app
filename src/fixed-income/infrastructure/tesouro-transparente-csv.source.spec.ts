import { TesouroTransparenteCsvSource } from './tesouro-transparente-csv.source';
import { TESOURO_CSV_HEADER } from './tesouro-csv-parser';

const CATALOG = 'package_show';
const CSV_URL =
	'https://www.tesourotransparente.gov.br/ckan/dataset/x/resource/y/download/precotaxatesourodireto.csv';

const csv = [
	TESOURO_CSV_HEADER,
	'Tesouro Selic;01/03/2031;02/10/2026;0,09;0,10;19943,12;19924,17;19924,17',
	'Tesouro Prefixado;01/01/2031;02/10/2026;14,07;14,19;574,80;572,10;572,10',
	'Tesouro Selic;01/03/2031;01/10/2026;0,08;0,09;19900,00;19890,00;19890,00',
].join('\n');

/** Corpo em pedaços que cortam linha no meio, como a rede faz. */
function streamOf(text: string, chunkSize: number): ReadableStream<Uint8Array> {
	const bytes = new TextEncoder().encode(text);
	let offset = 0;
	return new ReadableStream({
		pull(controller) {
			if (offset >= bytes.length) return controller.close();
			controller.enqueue(bytes.slice(offset, offset + chunkSize));
			offset += chunkSize;
		},
	});
}

const jsonResponse = (body: unknown) =>
	new Response(JSON.stringify(body), { status: 200 });

function sourceWith(handler: (url: string) => Response | Promise<Response>) {
	const source = new TesouroTransparenteCsvSource();
	const calls: string[] = [];
	source.fetchImpl = (async (input: RequestInfo | URL) => {
		const url = String(input);
		calls.push(url);
		return handler(url);
	}) as typeof fetch;
	return { source, calls };
}

describe('TesouroTransparenteCsvSource', () => {
	it('descobre o CSV pelo catálogo e lê o último pregão mesmo com linhas cortadas', async () => {
		const { source, calls } = sourceWith((url) =>
			url.includes(CATALOG)
				? jsonResponse({
						result: {
							resources: [
								{
									format: 'PDF',
									url: 'https://www.tesourotransparente.gov.br/x.pdf',
								},
								{ format: 'CSV', url: CSV_URL },
							],
						},
					})
				: new Response(streamOf(csv, 7), { status: 200 })
		);

		const snapshot = await source.fetchLatest();

		expect(calls[1]).toBe(CSV_URL);
		expect(snapshot.sourceUrl).toBe(CSV_URL);
		expect(snapshot.baseDate).toBe('2026-10-02');
		expect(snapshot.titles.map((title) => title.id).sort()).toEqual([
			'PREFIXED:2031-01-01',
			'SELIC:2031-03-01',
		]);
	});

	it('lê a última linha mesmo sem quebra de linha no fim do arquivo', async () => {
		const { source } = sourceWith((url) =>
			url.includes(CATALOG)
				? jsonResponse({
						result: { resources: [{ format: 'CSV', url: CSV_URL }] },
					})
				: new Response(streamOf(csv.trimEnd(), 1000), { status: 200 })
		);
		const snapshot = await source.fetchLatest();
		expect(snapshot.titles).toHaveLength(2);
	});

	it('catálogo fora do ar: usa o endereço conhecido do arquivo', async () => {
		const { source, calls } = sourceWith((url) =>
			url.includes(CATALOG)
				? new Response('boom', { status: 502 })
				: new Response(streamOf(csv, 50), { status: 200 })
		);
		const snapshot = await source.fetchLatest();
		expect(snapshot.titles).toHaveLength(2);
		expect(calls[1]).toContain('precotaxatesourodireto.csv');
		expect(calls[1]).toContain('tesourotransparente.gov.br');
	});

	it.each([
		'http://www.tesourotransparente.gov.br/a.csv',
		'https://evil.example.com/tesourotransparente.gov.br/a.csv',
		'https://eviltesourotransparente.gov.br/a.csv',
	])(
		'não segue endereço de CSV fora do domínio do Tesouro: %s',
		async (evilUrl) => {
			const { source, calls } = sourceWith((url) =>
				url.includes(CATALOG)
					? jsonResponse({
							result: { resources: [{ format: 'CSV', url: evilUrl }] },
						})
					: new Response(streamOf(csv, 50), { status: 200 })
			);
			await source.fetchLatest();
			expect(calls).not.toContain(evilUrl);
			expect(calls[1]).toContain('www.tesourotransparente.gov.br');
		}
	);

	it('HTTP de erro no download falha (o serviço mantém o pregão guardado)', async () => {
		const { source } = sourceWith((url) =>
			url.includes(CATALOG)
				? jsonResponse({
						result: { resources: [{ format: 'CSV', url: CSV_URL }] },
					})
				: new Response('nope', { status: 503 })
		);
		await expect(source.fetchLatest()).rejects.toThrow('HTTP 503');
	});

	it('CSV sem título suportado falha em vez de devolver tabela vazia', async () => {
		const empty = `${TESOURO_CSV_HEADER}\nTesouro Educa+;15/12/2031;02/10/2026;7,42;7,54;3932,12;3920,00;3920,00`;
		const { source } = sourceWith((url) =>
			url.includes(CATALOG)
				? jsonResponse({
						result: { resources: [{ format: 'CSV', url: CSV_URL }] },
					})
				: new Response(streamOf(empty, 100), { status: 200 })
		);
		await expect(source.fetchLatest()).rejects.toThrow(
			'nenhum título suportado'
		);
	});
});
