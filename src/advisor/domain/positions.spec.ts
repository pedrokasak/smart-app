import {
	AssetClass,
	Provenance,
	TransactionSide,
	TransactionSource,
} from './enums';
import { Transaction } from './portfolio.entities';
import { derivePositions, findOversell, sortLedger } from './positions';

const { Buy, Sell } = TransactionSide;
let seq = 0;

function tx(overrides: Partial<Transaction> = {}): Transaction {
	seq += 1;
	return {
		id: `t${seq}`,
		orgId: 'org',
		clientProfileId: 'cp',
		symbol: 'PETR4',
		assetClass: AssetClass.Stock,
		side: Buy,
		quantity: 10,
		unitPriceMinor: 1000,
		feesMinor: 0,
		currency: 'BRL',
		tradeDate: '2025-01-02',
		provenance: Provenance.Verified,
		source: TransactionSource.ManualEntry,
		createdByUserId: 'u',
		createdAt: new Date(2025, 0, 1, 0, 0, seq),
		...overrides,
	};
}

describe('derivePositions', () => {
	it('custo medio: duas compras e uma venda parcial', () => {
		const { positions } = derivePositions([
			tx({
				side: Buy,
				quantity: 100,
				unitPriceMinor: 1000,
				tradeDate: '2025-01-02',
			}),
			tx({
				side: Buy,
				quantity: 100,
				unitPriceMinor: 2000,
				tradeDate: '2025-01-03',
			}),
			tx({
				side: Sell,
				quantity: 50,
				unitPriceMinor: 3000,
				tradeDate: '2025-01-06',
			}),
		]);
		expect(positions).toEqual([
			expect.objectContaining({
				symbol: 'PETR4',
				quantity: 150,
				costMinor: 225000,
			}),
		]);
	});

	it('taxa de compra entra no custo', () => {
		const { positions } = derivePositions([
			tx({ quantity: 10, unitPriceMinor: 1000, feesMinor: 250 }),
		]);
		expect(positions[0].costMinor).toBe(10250);
	});

	it('venda total remove a posicao', () => {
		expect(
			derivePositions([
				tx({ side: Buy, quantity: 10, tradeDate: '2025-01-02' }),
				tx({ side: Sell, quantity: 10, tradeDate: '2025-01-03' }),
			])
		).toEqual({ positions: [], inconsistencies: [] });
	});

	it('procedencia: VERIFIED so se todas as transacoes forem', () => {
		const all = derivePositions([tx(), tx({ tradeDate: '2025-01-03' })]);
		expect(all.positions[0].provenance).toBe(Provenance.Verified);
		const mixed = derivePositions([
			tx(),
			tx({ tradeDate: '2025-01-03', provenance: Provenance.Manual }),
		]);
		expect(mixed.positions[0].provenance).toBe(Provenance.Manual);
	});

	it('compra e venda no mesmo dia: compra e processada antes', () => {
		const sell = tx({ side: Sell, quantity: 10, tradeDate: '2025-01-02' });
		const buy = tx({ side: Buy, quantity: 10, tradeDate: '2025-01-02' });
		expect(sell.createdAt.getTime()).toBeLessThan(buy.createdAt.getTime());
		expect(derivePositions([sell, buy])).toEqual({
			positions: [],
			inconsistencies: [],
		});
	});

	it('venda sem saldo nao lanca e registra inconsistencia', () => {
		expect(
			derivePositions([
				tx({ side: Sell, quantity: 10, tradeDate: '2025-01-02' }),
			])
		).toEqual({ positions: [], inconsistencies: ['PETR4@2025-01-02'] });
	});

	it('venda maior que o saldo zera a posicao e registra', () => {
		expect(
			derivePositions([
				tx({ side: Buy, quantity: 5, tradeDate: '2025-01-02' }),
				tx({ side: Sell, quantity: 8, tradeDate: '2025-01-03' }),
			])
		).toEqual({ positions: [], inconsistencies: ['PETR4@2025-01-03'] });
	});

	it('quantidade residual abaixo de 1e-8 fecha a posicao', () => {
		const { positions, inconsistencies } = derivePositions([
			tx({ quantity: 0.1, tradeDate: '2025-01-02' }),
			tx({ quantity: 0.2, tradeDate: '2025-01-03' }),
			tx({ side: Sell, quantity: 0.3, tradeDate: '2025-01-04' }),
		]);
		expect(positions).toEqual([]);
		expect(inconsistencies).toEqual([]);
	});

	it('separa posicoes por simbolo', () => {
		const { positions } = derivePositions([
			tx({ symbol: 'PETR4' }),
			tx({ symbol: 'HGLG11', assetClass: AssetClass.Fii }),
		]);
		expect(positions.map((p) => p.symbol).sort()).toEqual(['HGLG11', 'PETR4']);
	});

	it('liquidityDays vem da transacao mais recente que informou', () => {
		const { positions } = derivePositions([
			tx({ tradeDate: '2025-01-02', liquidityDays: 5 }),
			tx({ tradeDate: '2025-01-03', liquidityDays: 2 }),
			tx({ tradeDate: '2025-01-04' }),
		]);
		expect(positions[0].liquidityDays).toBe(2);
	});
});

describe('sortLedger', () => {
	it('ordena por data, BUY antes de SELL, depois createdAt', () => {
		const a = tx({ side: Sell, tradeDate: '2025-01-02' });
		const b = tx({ side: Buy, tradeDate: '2025-01-02' });
		const c = tx({ side: Buy, tradeDate: '2025-01-01' });
		const d = tx({ side: Buy, tradeDate: '2025-01-02' });
		expect(sortLedger([a, d, b, c]).map((t) => t.id)).toEqual([
			c.id,
			b.id,
			d.id,
			a.id,
		]);
	});

	it('nao muta a entrada', () => {
		const items = [
			tx({ tradeDate: '2025-01-03' }),
			tx({ tradeDate: '2025-01-02' }),
		];
		const copy = [...items];
		sortLedger(items);
		expect(items).toEqual(copy);
	});
});

describe('findOversell', () => {
	it('ignora diferenca de arredondamento', () => {
		expect(
			findOversell([
				tx({ quantity: 0.1, tradeDate: '2025-01-02' }),
				tx({ quantity: 0.2, tradeDate: '2025-01-03' }),
				tx({ side: Sell, quantity: 0.3, tradeDate: '2025-01-04' }),
			])
		).toBeNull();
	});

	it('acha a venda descoberta', () => {
		expect(
			findOversell([
				tx({ quantity: 10, tradeDate: '2025-01-02' }),
				tx({ side: Sell, quantity: 11, tradeDate: '2025-01-05' }),
			])
		).toEqual({ symbol: 'PETR4', tradeDate: '2025-01-05' });
	});

	it('devolve null sem vendas descobertas', () => {
		expect(findOversell([tx()])).toBeNull();
	});
});

describe('findOversell e derivePositions concordam', () => {
	const cases: Array<[string, () => Transaction[], boolean]> = [
		[
			'venda de poeira sem posicao',
			() => [tx({ side: Sell, quantity: 1e-8, tradeDate: '2025-01-02' })],
			true,
		],
		[
			'venda de poeira depois de fechar a posicao',
			() => [
				tx({ quantity: 0.5, tradeDate: '2025-01-02' }),
				tx({ side: Sell, quantity: 0.5, tradeDate: '2025-01-03' }),
				tx({ side: Sell, quantity: 1e-8, tradeDate: '2025-01-04' }),
			],
			true,
		],
		[
			'venda que excede o saldo exatamente pelo epsilon',
			() => [
				tx({ quantity: 1, tradeDate: '2025-01-02' }),
				tx({ side: Sell, quantity: 1.00000001, tradeDate: '2025-01-03' }),
			],
			false,
		],
		[
			'0.1 + 0.2 e venda de 0.3',
			() => [
				tx({ quantity: 0.1, tradeDate: '2025-01-02' }),
				tx({ quantity: 0.2, tradeDate: '2025-01-03' }),
				tx({ side: Sell, quantity: 0.3, tradeDate: '2025-01-04' }),
			],
			false,
		],
		[
			'venda descoberta comum',
			() => [
				tx({ quantity: 10, tradeDate: '2025-01-02' }),
				tx({ side: Sell, quantity: 11, tradeDate: '2025-01-03' }),
			],
			true,
		],
		[
			'livro sem problemas',
			() => [
				tx({ quantity: 10, tradeDate: '2025-01-02' }),
				tx({ side: Sell, quantity: 4, tradeDate: '2025-01-03' }),
			],
			false,
		],
	];

	it.each(cases)('%s', (_name, build, oversold) => {
		const ledger = build();
		const derived = derivePositions(ledger);
		expect(findOversell(ledger) !== null).toBe(oversold);
		expect(derived.inconsistencies.length > 0).toBe(oversold);
	});
});
