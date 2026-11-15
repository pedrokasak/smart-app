import { buildWallet, strictestPositionLimit } from './mobile-wallet';

describe('buildWallet', () => {
	const assets = [
		{
			symbol: 'petr4',
			name: 'Petrobras PN',
			type: 'stock',
			quantity: 100,
			price: 30,
			currentPrice: 40,
		},
		{
			symbol: 'PETR4',
			type: 'stock',
			quantity: 50,
			price: 36,
			currentPrice: 40,
		},
		{
			symbol: 'HGLG11',
			name: 'CSHG Logística',
			type: 'fii',
			quantity: 10,
			price: 160,
			currentPrice: 150,
		},
		{
			symbol: 'BTC',
			type: 'crypto',
			quantity: 0.01,
			price: 300000,
			currentPrice: 400000,
		},
		{ symbol: 'VAZIO', type: 'stock', quantity: 0, price: 10 },
	];

	it('soma o mesmo símbolo entre carteiras, a valor de mercado', () => {
		const wallet = buildWallet(assets, null);
		const petr = wallet.positions.find((p) => p.symbol === 'PETR4')!;

		expect(petr.quantity).toBe(150);
		expect(petr.value).toBe(6000);
		expect(petr.cost).toBe(4800);
		expect(petr.resultPct).toBe(25);
		expect(petr.name).toBe('Petrobras PN');
		expect(petr.bucket).toBe('stocks');
	});

	it('ordena por valor e calcula peso e resultado total', () => {
		const wallet = buildWallet(assets, null);

		expect(wallet.positions.map((p) => p.symbol)).toEqual([
			'PETR4',
			'BTC',
			'HGLG11',
		]);
		expect(wallet.totalValue).toBe(11500);
		expect(wallet.totalCost).toBe(9400);
		expect(wallet.result).toBe(2100);
		expect(wallet.positions[0].weightPct).toBe(52.17);
	});

	it('marca quem passou do limite por ativo', () => {
		const wallet = buildWallet(assets, 40);

		expect(
			wallet.positions.filter((p) => p.overLimit).map((p) => p.symbol)
		).toEqual(['PETR4']);
		expect(wallet.maxPositionPct).toBe(40);
	});

	it('sem custo conhecido, o resultado fica nulo em vez de infinito', () => {
		const wallet = buildWallet(
			[{ symbol: 'X', quantity: 1, currentPrice: 10 }],
			null
		);

		expect(wallet.positions[0].resultPct).toBeNull();
		expect(wallet.resultPct).toBeNull();
	});

	it('carteira vazia não divide por zero', () => {
		expect(buildWallet([], null)).toEqual({
			totalValue: 0,
			totalCost: 0,
			result: 0,
			resultPct: null,
			maxPositionPct: null,
			positions: [],
		});
	});
});

describe('strictestPositionLimit', () => {
	it('usa o menor limite entre as carteiras com política', () => {
		expect(
			strictestPositionLimit([
				{ policy: { maxPositionPct: 20 } },
				{ policy: null },
				{ policy: { maxPositionPct: 8 } },
			])
		).toBe(8);
	});

	it('sem política nenhuma, não há limite', () => {
		expect(strictestPositionLimit([{}, { policy: null }])).toBeNull();
	});
});
