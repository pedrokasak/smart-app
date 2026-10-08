import yauzl from 'yauzl';

export class ZipEntryTooLargeError extends Error {
	constructor(fileName: string, maxBytes: number) {
		super(`${fileName} passou de ${maxBytes} bytes descomprimido`);
		this.name = 'ZipEntryTooLargeError';
	}
}

/**
 * Lê UM arquivo de dentro de um zip em pedaços, sem montar o arquivo inteiro
 * na memória (o Informe Diário da CVM tem ~54 MB descomprimido por mês).
 *
 * O limite conta os bytes que de fato saem do inflate, não o tamanho que o
 * zip declara: um zip pode mentir no cabeçalho (zip bomb). Passou do limite,
 * a leitura é interrompida com `ZipEntryTooLargeError`.
 *
 * Devolve `false` quando o arquivo não está no zip.
 */
export function streamZipEntry(
	buffer: Buffer,
	fileName: string,
	maxBytes: number,
	onChunk: (chunk: Buffer) => void
): Promise<boolean> {
	return new Promise<boolean>((resolve, reject) => {
		// `validateEntrySizes: false`: com o tamanho declarado menor que o real,
		// o yauzl 2.10 para de emitir dados sem erro e a leitura fica pendurada
		// para sempre (conferido em teste). O teto abaixo, que conta os bytes
		// reais, é quem protege.
		const options = { lazyEntries: true, validateEntrySizes: false };
		yauzl.fromBuffer(buffer, options, (err, zipfile) => {
			if (err || !zipfile) {
				reject(err || new Error('zip_open_failed'));
				return;
			}
			let settled = false;
			const finish = (error: Error | null, found: boolean) => {
				if (settled) return;
				settled = true;
				zipfile.removeAllListeners();
				try {
					zipfile.close();
				} catch {
					// ignore
				}
				if (error) reject(error);
				else resolve(found);
			};

			zipfile.on('error', (e) => finish(e, false));
			zipfile.on('entry', (entry) => {
				if (entry.fileName !== fileName) {
					zipfile.readEntry();
					return;
				}
				if (entry.uncompressedSize > maxBytes) {
					finish(new ZipEntryTooLargeError(fileName, maxBytes), false);
					return;
				}
				zipfile.openReadStream(entry, (streamErr, stream) => {
					if (streamErr || !stream) {
						finish(streamErr || new Error('zip_read_stream_failed'), false);
						return;
					}
					let total = 0;
					stream.on('data', (chunk: Buffer) => {
						if (settled) return;
						total += chunk.length;
						if (total > maxBytes) {
							stream.destroy();
							finish(new ZipEntryTooLargeError(fileName, maxBytes), false);
							return;
						}
						try {
							onChunk(chunk);
						} catch (error) {
							stream.destroy();
							finish(error as Error, false);
						}
					});
					stream.on('error', (e) => finish(e, false));
					stream.on('end', () => finish(null, true));
				});
			});
			zipfile.on('end', () => finish(null, false));
			zipfile.readEntry();
		});
	});
}

/**
 * Quebra os pedaços de `streamZipEntry` em linhas. A CVM grava em ISO-8859-1;
 * o Informe Diário é ASCII puro, então a mesma decodificação serve aos dois.
 */
export async function streamZipEntryLines(
	buffer: Buffer,
	fileName: string,
	maxBytes: number,
	onLine: (line: string) => void
): Promise<boolean> {
	const decoder = new TextDecoder('latin1');
	let pending = '';
	const found = await streamZipEntry(buffer, fileName, maxBytes, (chunk) => {
		pending += decoder.decode(chunk, { stream: true });
		const lines = pending.split('\n');
		pending = lines.pop() ?? '';
		for (const line of lines) onLine(line);
	});
	pending += decoder.decode();
	if (found && pending) onLine(pending);
	return found;
}
