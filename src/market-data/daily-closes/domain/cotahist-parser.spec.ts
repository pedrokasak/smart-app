import { cotahistLine } from '../testing/cotahist-fixture';
import {
	COTAHIST_LINE_LENGTH,
	parseCotahist,
	parseCotahistLine,
} from './cotahist-parser';

describe('cotahist-parser (TRA-251)', () => {
	it('a linha de teste tem as 245 colunas do layout oficial', () => {
		expect(cotahistLine({ symbol: 'PETR4', close: 30 })).toHaveLength(
			COTAHIST_LINE_LENGTH
		);
	});

	it('lê símbolo, data e preços (centavos implícitos) do mercado à vista', () => {
		const quote = parseCotahistLine(
			cotahistLine({
				date: '20260105',
				symbol: 'PETR4',
				open: 30.1,
				high: 31.25,
				low: 29.9,
				close: 30.45,
				trades: 1234,
				volume: 98765.43,
			})
		);

		expect(quote).toEqual({
			symbol: 'PETR4',
			date: '2026-01-05',
			open: 30.1,
			high: 31.25,
			low: 29.9,
			close: 30.45,
			volume: 98765.43,
			trades: 1234,
		});
	});

	it('o fechamento é o último negócio (PREULT), não a média', () => {
		const line = cotahistLine({ symbol: 'VALE3', close: 60 });
		// PREMED (96-108) diferente de PREULT (109-121).
		const withDifferentAverage =
			line.slice(0, 95) + '0000000009999' + line.slice(108);

		expect(parseCotahistLine(withDifferentAverage)?.close).toBe(60);
	});

	it('FII e ETF (códigos com 11) também entram', () => {
		expect(
			parseCotahistLine(
				cotahistLine({ symbol: 'HGLG11', bdi: '12', close: 160 })
			)?.symbol
		).toBe('HGLG11');
		expect(
			parseCotahistLine(
				cotahistLine({ symbol: 'BOVA11', bdi: '14', close: 120 })
			)?.close
		).toBe(120);
	});

	it.each([
		['cabeçalho', { record: '00' }],
		['rodapé', { record: '99' }],
		['fracionário', { market: '020' }],
		['opção de compra', { market: '070' }],
		['termo', { market: '030' }],
	])('ignora %s', (_label, override) => {
		expect(
			parseCotahistLine(
				cotahistLine({ symbol: 'PETR4', close: 30, ...override })
			)
		).toBeNull();
	});

	it('ignora preço zero e linha curta ou malformada', () => {
		expect(
			parseCotahistLine(cotahistLine({ symbol: 'PETR4', close: 0 }))
		).toBeNull();
		expect(parseCotahistLine('01texto curto')).toBeNull();
		expect(parseCotahistLine('')).toBeNull();
		expect(
			parseCotahistLine(
				cotahistLine({ symbol: 'PETR4', close: 30, date: '20261340' })
			)
		).toBeNull();
	});

	it('papel cotado por lote tem o preço dividido pelo fator', () => {
		const quote = parseCotahistLine(
			cotahistLine({ symbol: 'LOTE3', close: 5000, factor: 1000 })
		);

		expect(quote?.close).toBe(5);
	});

	it('normaliza o código para maiúsculas, sem os espaços do campo fixo', () => {
		expect(
			parseCotahistLine(cotahistLine({ symbol: 'petr4', close: 30 }))?.symbol
		).toBe('PETR4');
	});

	describe('parseCotahist', () => {
		const lines = [
			cotahistLine({ record: '00', symbol: 'COTAHIST', close: 1 }),
			cotahistLine({ symbol: 'PETR4', close: 30 }),
			cotahistLine({ symbol: 'VALE3', close: 60 }),
			cotahistLine({ symbol: 'PETR4', close: 30, market: '020' }),
			cotahistLine({ record: '99', symbol: 'TRAILER', close: 1 }),
		];

		async function collect(
			source: Iterable<string> | AsyncIterable<string>,
			only?: ReadonlySet<string>
		) {
			const out: string[] = [];
			for await (const quote of parseCotahist(source, only)) {
				out.push(quote.symbol);
			}
			return out;
		}

		it('devolve só as cotações à vista', async () => {
			expect(await collect(lines)).toEqual(['PETR4', 'VALE3']);
		});

		it('restringe aos símbolos pedidos (limite de armazenamento)', async () => {
			expect(await collect(lines, new Set(['VALE3']))).toEqual(['VALE3']);
		});

		it('aceita um stream assíncrono de linhas', async () => {
			async function* stream() {
				for (const line of lines) yield line;
			}

			expect(await collect(stream())).toEqual(['PETR4', 'VALE3']);
		});
	});
});
