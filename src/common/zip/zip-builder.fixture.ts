import { deflateRawSync } from 'node:zlib';

/**
 * Monta um zip real (deflate) em memória para os testes exercitarem o yauzl
 * de verdade. Só para teste: não há lib de escrita de zip no projeto e um
 * base64 opaco não deixa ver o que está dentro do arquivo.
 */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

function crc32(data: Buffer): number {
	let crc = 0xffffffff;
	for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipFixtureEntry {
	name: string;
	content: Buffer | string;
	/** Tamanho descomprimido gravado no cabeçalho, para simular zip que mente. */
	declaredSize?: number;
}

export function buildZip(entries: ZipFixtureEntry[]): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;

	for (const entry of entries) {
		const raw = Buffer.isBuffer(entry.content)
			? entry.content
			: Buffer.from(entry.content, 'latin1');
		const compressed = deflateRawSync(raw);
		const name = Buffer.from(entry.name, 'utf8');
		const crc = crc32(raw);
		const size = entry.declaredSize ?? raw.length;

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0, 6);
		local.writeUInt16LE(8, 8);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(compressed.length, 18);
		local.writeUInt32LE(size, 22);
		local.writeUInt16LE(name.length, 26);
		locals.push(local, name, compressed);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0, 8);
		central.writeUInt16LE(8, 10);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(compressed.length, 20);
		central.writeUInt32LE(size, 24);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt32LE(offset, 42);
		centrals.push(central, name);

		offset += local.length + name.length + compressed.length;
	}

	const centralSize = centrals.reduce((acc, part) => acc + part.length, 0);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(centralSize, 12);
	end.writeUInt32LE(offset, 16);

	return Buffer.concat([...locals, ...centrals, end]);
}
