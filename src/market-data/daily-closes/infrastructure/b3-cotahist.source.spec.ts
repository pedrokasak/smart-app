import axios from 'axios';
import { cotahistLine, zipOf } from '../testing/cotahist-fixture';
import { DAILY_CLOSES_DEFAULTS } from '../application/daily-closes.config';
import { parseCotahist } from '../domain/cotahist-parser';
import { Readable } from 'stream';
import { B3CotahistSource, dayStamp, linesOf } from './b3-cotahist.source';

describe('linesOf (TRA-251)', () => {
	async function collect(stream: Readable) {
		const lines: string[] = [];
		for await (const line of linesOf(stream)) lines.push(line);
		return lines;
	}

	it('separa por quebra de linha e tira o CR do fim', async () => {
		const stream = Readable.from(['um\r\ndois\r\ntres']);
		stream.setEncoding('latin1');

		expect(await collect(stream)).toEqual(['um', 'dois', 'tres']);
	});

	it('junta a linha cortada entre dois blocos, inclusive CR e LF separados', async () => {
		const stream = Readable.from(['abc', 'def\r', '\nghi\n', 'jkl']);
		stream.setEncoding('latin1');

		expect(await collect(stream)).toEqual(['abcdef', 'ghi', 'jkl']);
	});

	it('arquivo vazio e arquivo que termina em quebra não geram linha extra', async () => {
		expect(await collect(Readable.from([]))).toEqual([]);
		expect(await collect(Readable.from(['a\n']))).toEqual(['a']);
	});

	it('erro no stream rejeita a iteração, em vez de derrubar o processo', async () => {
		const stream = new Readable({
			read() {
				this.destroy(new Error('deflate corrompido'));
			},
		});

		await expect(collect(stream)).rejects.toThrow('deflate corrompido');
	});
});

jest.mock('axios');
const get = axios.get as jest.Mock;

async function symbolsOf(lines: AsyncIterable<string>) {
	const out: string[] = [];
	for await (const quote of parseCotahist(lines)) out.push(quote.symbol);
	return out;
}

describe('B3CotahistSource (TRA-251)', () => {
	const source = new B3CotahistSource(DAILY_CLOSES_DEFAULTS);

	beforeEach(() => get.mockReset());

	it('o arquivo do dia usa a data como DDMMAAAA', () => {
		expect(dayStamp('2026-10-07')).toBe('07102026');
	});

	it('baixa o arquivo do dia e devolve as linhas do TXT', async () => {
		const content = [
			cotahistLine({ symbol: 'PETR4', close: 30 }),
			cotahistLine({ symbol: 'VALE3', close: 60 }),
		].join('\r\n');
		get.mockResolvedValue({ status: 200, data: zipOf(content) });

		const lines = await source.fetchDay('2026-10-07');

		expect(get.mock.calls[0][0]).toBe(
			`${DAILY_CLOSES_DEFAULTS.baseUrl}/COTAHIST_D07102026.ZIP`
		);
		expect(await symbolsOf(lines!)).toEqual(['PETR4', 'VALE3']);
	});

	it('o arquivo anual usa o ano no nome', async () => {
		get.mockResolvedValue({
			status: 200,
			data: zipOf(cotahistLine({ symbol: 'PETR4', close: 30 })),
		});

		await source.fetchYear(2025);

		expect(get.mock.calls[0][0]).toBe(
			`${DAILY_CLOSES_DEFAULTS.baseUrl}/COTAHIST_A2025.ZIP`
		);
	});

	it('404 é "não publicado", não erro', async () => {
		get.mockResolvedValue({ status: 404, data: new ArrayBuffer(0) });

		expect(await source.fetchDay('2026-10-10')).toBeNull();
	});

	it('só 200 e 404 passam como resposta; o resto sobe como erro', async () => {
		get.mockResolvedValue({ status: 200, data: zipOf('x') });
		await source.fetchDay('2026-10-07');

		const { validateStatus, responseType } = get.mock.calls[0][1];
		expect(responseType).toBe('arraybuffer');
		expect(validateStatus(200)).toBe(true);
		expect(validateStatus(404)).toBe(true);
		expect(validateStatus(500)).toBe(false);
		expect(validateStatus(403)).toBe(false);
	});

	it('resposta que não é ZIP (página de erro) falha alto', async () => {
		get.mockResolvedValue({
			status: 200,
			data: Buffer.from('<html>indisponível</html>'),
		});

		await expect(source.fetchDay('2026-10-07')).rejects.toThrow('ZIP inválido');
	});

	it('ZIP com deflate corrompido rejeita ao ler, sem derrubar o processo', async () => {
		const zip = zipOf(
			Array.from({ length: 200 }, () =>
				cotahistLine({ symbol: 'PETR4', close: 30 })
			).join('\n')
		);
		// Estraga o meio dos dados comprimidos, mantendo o diretório central.
		for (let i = 60; i < 120; i += 1) zip[i] = 0xff;
		get.mockResolvedValue({ status: 200, data: zip });

		const lines = await source.fetchDay('2026-10-07');

		await expect(symbolsOf(lines!)).rejects.toThrow();
	});

	it('respeita a URL base configurada', async () => {
		get.mockResolvedValue({ status: 404, data: new ArrayBuffer(0) });

		await new B3CotahistSource({
			...DAILY_CLOSES_DEFAULTS,
			baseUrl: 'https://espelho.exemplo.com/serie',
		}).fetchYear(2024);

		expect(get.mock.calls[0][0]).toBe(
			'https://espelho.exemplo.com/serie/COTAHIST_A2024.ZIP'
		);
	});
});
