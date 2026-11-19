import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ASSET_PRICE_MAX } from 'src/assets/dto/create-asset.dto';
import { SALE_QUANTITY_MAX, SalePreviewDto } from './sale-preview.dto';

const invalid = (body: object) =>
	validateSync(plainToInstance(SalePreviewDto, body)).map(
		(error) => error.property
	);

describe('SalePreviewDto (TRA-285)', () => {
	const base = { symbol: 'PETR4', quantity: 100, sellPrice: 38.5 };

	it('aceita o mínimo, carteira válida e os tetos exatos', () => {
		expect(invalid(base)).toEqual([]);
		expect(
			invalid({ ...base, portfolioId: '64b7f0c2a1b2c3d4e5f60718' })
		).toEqual([]);
		expect(
			invalid({
				...base,
				quantity: SALE_QUANTITY_MAX,
				sellPrice: ASSET_PRICE_MAX,
			})
		).toEqual([]);
	});

	it('aceita fração de cripto e preço abaixo de R$ 0,01', () => {
		expect(
			invalid({ symbol: 'SHIB', quantity: 0.5, sellPrice: 0.0001 })
		).toEqual([]);
	});

	it('recusa valores acima do teto', () => {
		expect(
			invalid({
				...base,
				quantity: SALE_QUANTITY_MAX + 1,
				sellPrice: ASSET_PRICE_MAX + 1,
			})
		).toEqual(['quantity', 'sellPrice']);
	});

	it('recusa símbolo vazio, zero, negativo, texto e carteira inválida', () => {
		expect(
			invalid({
				symbol: '',
				quantity: 0,
				sellPrice: '38,50',
				portfolioId: 'todas',
			})
		).toEqual(['symbol', 'quantity', 'sellPrice', 'portfolioId']);
		expect(invalid({ ...base, quantity: -1, sellPrice: -1 })).toEqual([
			'quantity',
			'sellPrice',
		]);
	});

	it('recusa NaN e infinito', () => {
		expect(invalid({ ...base, quantity: NaN, sellPrice: Infinity })).toEqual([
			'quantity',
			'sellPrice',
		]);
	});
});
