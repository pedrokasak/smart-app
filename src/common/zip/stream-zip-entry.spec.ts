import {
	ZipEntryTooLargeError,
	streamZipEntry,
	streamZipEntryLines,
} from './stream-zip-entry';
import { buildZip } from './zip-builder.fixture';

describe('streamZipEntry', () => {
	const zip = buildZip([
		{ name: 'leia-me.txt', content: 'nada' },
		{ name: 'dados.csv', content: 'a;b\r\n1;2\r\n3;4' },
	]);

	it('streams the requested entry, skipping the others', async () => {
		const chunks: Buffer[] = [];
		const found = await streamZipEntry(zip, 'dados.csv', 1024, (chunk) =>
			chunks.push(chunk)
		);

		expect(found).toBe(true);
		expect(Buffer.concat(chunks).toString('latin1')).toBe('a;b\r\n1;2\r\n3;4');
	});

	it('returns false when the entry is not in the zip', async () => {
		await expect(
			streamZipEntry(zip, 'outro.csv', 1024, () => undefined)
		).resolves.toBe(false);
	});

	it('refuses an entry whose declared size is over the limit', async () => {
		await expect(
			streamZipEntry(zip, 'dados.csv', 4, () => undefined)
		).rejects.toBeInstanceOf(ZipEntryTooLargeError);
	});

	it('refuses a zip that lies about the uncompressed size', async () => {
		const lying = buildZip([
			{ name: 'bomba.csv', content: 'x'.repeat(5000), declaredSize: 10 },
		]);

		// O cabeçalho diz 10 bytes; o teto conta os 5.000 que saem do inflate.
		await expect(
			streamZipEntry(lying, 'bomba.csv', 100, () => undefined)
		).rejects.toBeInstanceOf(ZipEntryTooLargeError);
	});

	it('propagates an error thrown by the consumer', async () => {
		await expect(
			streamZipEntry(zip, 'dados.csv', 1024, () => {
				throw new Error('cabeçalho mudou');
			})
		).rejects.toThrow('cabeçalho mudou');
	});

	it('rejects a corrupted zip', async () => {
		await expect(
			streamZipEntry(Buffer.from('isto nao e um zip'), 'x', 10, () => undefined)
		).rejects.toThrow();
	});
});

describe('streamZipEntryLines', () => {
	it('splits lines and decodes ISO-8859-1', async () => {
		const zip = buildZip([
			{
				name: 'r.csv',
				content: Buffer.from('Nome;Situação\nAÇÕES;Normal', 'latin1'),
			},
		]);
		const lines: string[] = [];

		await streamZipEntryLines(zip, 'r.csv', 1024, (line) => lines.push(line));

		expect(lines).toEqual(['Nome;Situação', 'AÇÕES;Normal']);
	});
});
