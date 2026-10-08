import { Readable } from 'stream';
import { createInflateRaw } from 'zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;

/**
 * Stream do conteúdo da primeira entrada de um ZIP em memória.
 *
 * O arquivo da B3 tem uma entrada só (o .TXT). Lê o diretório central, e não
 * o cabeçalho local, porque o tamanho comprimido do local pode vir zerado
 * quando o ZIP foi gerado em streaming. Devolve um stream: o arquivo anual
 * descomprime para centenas de MB, que não cabem inteiros em memória.
 *
 * Não suporta ZIP64 (arquivos acima de 4 GB), que a B3 não publica.
 */
export function firstZipEntryStream(zip: Buffer): Readable {
	const eocd = findEndOfCentralDirectory(zip);
	const centralOffset = zip.readUInt32LE(eocd + 16);
	if (zip.readUInt32LE(centralOffset) !== CENTRAL_SIGNATURE) {
		throw new Error('ZIP inválido: diretório central ausente');
	}

	const method = zip.readUInt16LE(centralOffset + 10);
	const compressedSize = zip.readUInt32LE(centralOffset + 20);
	const localOffset = zip.readUInt32LE(centralOffset + 42);
	if (zip.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
		throw new Error('ZIP inválido: cabeçalho local ausente');
	}

	const nameLength = zip.readUInt16LE(localOffset + 26);
	const extraLength = zip.readUInt16LE(localOffset + 28);
	const start = localOffset + 30 + nameLength + extraLength;
	const data = zip.subarray(start, start + compressedSize);

	if (method === STORED) return Readable.from([data]);
	if (method === DEFLATED) {
		return Readable.from([data]).pipe(createInflateRaw());
	}
	throw new Error(`ZIP com método de compressão ${method} não suportado`);
}

function findEndOfCentralDirectory(zip: Buffer): number {
	const lowest = Math.max(0, zip.length - 22 - 0xffff);
	for (let i = zip.length - 22; i >= lowest; i -= 1) {
		if (zip.readUInt32LE(i) === EOCD_SIGNATURE) return i;
	}
	throw new Error('ZIP inválido: fim do diretório central não encontrado');
}
