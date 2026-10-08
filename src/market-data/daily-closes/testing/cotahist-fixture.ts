import { deflateRawSync } from 'zlib';

export interface LineSpec {
	record?: string;
	date?: string;
	bdi?: string;
	symbol: string;
	market?: string;
	open?: number;
	high?: number;
	low?: number;
	close: number;
	trades?: number;
	volume?: number;
	factor?: number;
}

const num = (value: number, width: number) =>
	String(Math.round(value)).padStart(width, '0');
const text = (value: string, width: number) => value.padEnd(width, ' ');

/**
 * Linha do COTAHIST no layout oficial de 245 colunas (posições 1-based do
 * manual entre parênteses). Preços em reais viram centavos inteiros.
 */
export function cotahistLine(spec: LineSpec): string {
	const price = (value = 0) => num(value * 100, 13);
	const parts = [
		text(spec.record ?? '01', 2), // TIPREG (1-2)
		spec.date ?? '20260105', // DATA (3-10)
		text(spec.bdi ?? '02', 2), // CODBDI (11-12)
		text(spec.symbol, 12), // CODNEG (13-24)
		text(spec.market ?? '010', 3), // TPMERC (25-27)
		text('NOME RES', 12), // NOMRES (28-39)
		text('ON', 10), // ESPECI (40-49)
		text('', 3), // PRAZOT (50-52)
		text('R$', 4), // MODREF (53-56)
		price(spec.open ?? spec.close), // PREABE (57-69)
		price(spec.high ?? spec.close), // PREMAX (70-82)
		price(spec.low ?? spec.close), // PREMIN (83-95)
		price(spec.close), // PREMED (96-108)
		price(spec.close), // PREULT (109-121)
		price(spec.close), // PREOFC (122-134)
		price(spec.close), // PREOFV (135-147)
		num(spec.trades ?? 10, 5), // TOTNEG (148-152)
		num(100, 18), // QUATOT (153-170)
		num((spec.volume ?? 1000) * 100, 18), // VOLTOT (171-188)
		price(0), // PREEXE (189-201)
		'0', // INDOPC (202)
		'99991231', // DATVEN (203-210)
		num(spec.factor ?? 1, 7), // FATCOT (211-217)
		num(0, 13), // PTOEXE (218-230)
		text('BRXXXXACNOR0', 12), // CODISI (231-242)
		'000', // DISMES (243-245)
	];
	return parts.join('');
}

const u16 = (value: number) => {
	const buffer = Buffer.alloc(2);
	buffer.writeUInt16LE(value);
	return buffer;
};
const u32 = (value: number) => {
	const buffer = Buffer.alloc(4);
	buffer.writeUInt32LE(value >>> 0);
	return buffer;
};

/** ZIP de uma entrada só, com o diretório central, como a B3 publica. */
export function zipOf(
	content: string,
	options: { method?: 'deflate' | 'store'; name?: string } = {}
): Buffer {
	const name = Buffer.from(options.name ?? 'COTAHIST.TXT');
	const raw = Buffer.from(content, 'latin1');
	const stored = options.method === 'store';
	const data = stored ? raw : deflateRawSync(raw);
	const method = stored ? 0 : 8;
	// O leitor não confere CRC; o valor não importa para o teste.
	const checksum = 0;

	const local = Buffer.concat([
		u32(0x04034b50),
		u16(20),
		u16(0),
		u16(method),
		u16(0),
		u16(0),
		u32(checksum),
		u32(data.length),
		u32(raw.length),
		u16(name.length),
		u16(0),
		name,
		data,
	]);
	const central = Buffer.concat([
		u32(0x02014b50),
		u16(20),
		u16(20),
		u16(0),
		u16(method),
		u16(0),
		u16(0),
		u32(checksum),
		u32(data.length),
		u32(raw.length),
		u16(name.length),
		u16(0),
		u16(0),
		u16(0),
		u16(0),
		u32(0),
		u32(0),
		name,
	]);
	const end = Buffer.concat([
		u32(0x06054b50),
		u16(0),
		u16(0),
		u16(1),
		u16(1),
		u32(central.length),
		u32(local.length),
		u16(0),
	]);
	return Buffer.concat([local, central, end]);
}
