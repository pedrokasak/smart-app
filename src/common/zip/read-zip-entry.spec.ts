import { readZipEntry } from 'src/common/zip/read-zip-entry';

/**
 * Zip real (deflate), gerado com o `zipfile` do Python: `leia-me.txt` e
 * `dados.csv` ("a;b\r\n1;2\r\n"). Sem lib de escrita de zip no projeto, o
 * fixture e o jeito de exercitar o yauzl de verdade.
 */
const ZIP_BASE64 =
	'UEsDBBQAAAAIAHJeQ12mx+NMDwAAAA0AAAALAAAAbGVpYS1tZS50eHTLLy0pyldILCoszSzLBwBQSwMEFAAAAAgAcl5DXWz0tuoMAAAACgAAAAkAAABkYWRvcy5jc3ZLtE7i5TK0NuLlAgBQSwECFAAUAAAACAByXkNdpsfjTA8AAAANAAAACwAAAAAAAAAAAAAAgAEAAAAAbGVpYS1tZS50eHRQSwECFAAUAAAACAByXkNdbPS26gwAAAAKAAAACQAAAAAAAAAAAAAAgAE4AAAAZGFkb3MuY3N2UEsFBgAAAAACAAIAcAAAAGsAAAAAAA==';

describe('readZipEntry', () => {
	const zip = Buffer.from(ZIP_BASE64, 'base64');

	it('reads the requested file, skipping the others', async () => {
		const data = await readZipEntry(zip, 'dados.csv');

		expect(data?.toString('utf8')).toBe('a;b\r\n1;2\r\n');
	});

	it('returns null when the file is not in the zip', async () => {
		await expect(readZipEntry(zip, 'outro.csv')).resolves.toBeNull();
	});

	it('rejects a corrupted zip', async () => {
		await expect(
			readZipEntry(Buffer.from('isto nao e um zip'), 'dados.csv')
		).rejects.toThrow();
	});
});
