import { cotahistLine, zipOf } from '../testing/cotahist-fixture';
import { firstZipEntryStream } from './zip-first-entry';

async function read(stream: NodeJS.ReadableStream): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks).toString('latin1');
}

describe('firstZipEntryStream (TRA-251)', () => {
	const content = [
		cotahistLine({ symbol: 'PETR4', close: 30 }),
		cotahistLine({ symbol: 'VALE3', close: 60 }),
	].join('\r\n');

	it('descomprime a primeira entrada (deflate)', async () => {
		expect(await read(firstZipEntryStream(zipOf(content)))).toBe(content);
	});

	it('lê entrada sem compressão', async () => {
		expect(
			await read(firstZipEntryStream(zipOf(content, { method: 'store' })))
		).toBe(content);
	});

	it('preserva os bytes ISO-8859-1', async () => {
		const accented = 'AÇÃO PREFERENCIAL';

		expect(await read(firstZipEntryStream(zipOf(accented)))).toBe(accented);
	});

	it('conteúdo grande não precisa caber de uma vez', async () => {
		const big = Array.from({ length: 5000 }, () =>
			cotahistLine({ symbol: 'PETR4', close: 30 })
		).join('\n');

		const text = await read(firstZipEntryStream(zipOf(big)));

		expect(text).toHaveLength(big.length);
	});

	it('recusa o que não é ZIP', () => {
		expect(() => firstZipEntryStream(Buffer.from('<html>erro</html>'))).toThrow(
			'ZIP inválido'
		);
	});

	it('recusa ZIP cortado no meio', () => {
		const zip = zipOf(content);

		expect(() => firstZipEntryStream(zip.subarray(0, zip.length - 30))).toThrow(
			'ZIP inválido'
		);
	});
});
