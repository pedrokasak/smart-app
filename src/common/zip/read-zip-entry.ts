import yauzl from 'yauzl';

/**
 * Le em memoria UM arquivo de dentro de um zip — os dados abertos da CVM
 * (IPE, informe mensal de FII) so vem zipados, com varios CSVs dentro.
 *
 * Devolve `null` quando o arquivo nao esta no zip; rejeita quando o zip esta
 * corrompido. Cada CSV anual da CVM tem poucos MB a dezenas de MB
 * descomprimido: cabe em memoria numa rotina eventual.
 */
export function readZipEntry(
	buffer: Buffer,
	fileName: string
): Promise<Buffer | null> {
	return new Promise<Buffer | null>((resolve, reject) => {
		yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
			if (err || !zipfile) {
				reject(err || new Error('zip_open_failed'));
				return;
			}
			let settled = false;
			const finish = (error: Error | null, data: Buffer | null) => {
				if (settled) return;
				settled = true;
				zipfile.removeAllListeners();
				try {
					zipfile.close();
				} catch {
					// ignore
				}
				if (error) reject(error);
				else resolve(data);
			};

			zipfile.on('error', (e) => finish(e, null));
			zipfile.on('entry', (entry) => {
				if (entry.fileName !== fileName) {
					zipfile.readEntry();
					return;
				}
				zipfile.openReadStream(entry, (streamErr, stream) => {
					if (streamErr || !stream) {
						finish(streamErr || new Error('zip_read_stream_failed'), null);
						return;
					}
					const chunks: Buffer[] = [];
					stream.on('data', (chunk: Buffer) => chunks.push(chunk));
					stream.on('error', (e) => finish(e, null));
					stream.on('end', () => finish(null, Buffer.concat(chunks)));
				});
			});
			// Nenhuma entry com esse nome.
			zipfile.on('end', () => finish(null, null));
			zipfile.readEntry();
		});
	});
}
