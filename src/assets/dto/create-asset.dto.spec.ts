import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ASSET_PRICE_MAX, CreateAssetDto } from './create-asset.dto';
import { UpdateAssetDto } from './update-asset.dto';

const invalid = (dto: new () => object, body: object) =>
	validateSync(plainToInstance(dto, body)).map((error) => error.property);

describe('CreateAssetDto.price (TRA-285)', () => {
	const base = { symbol: 'VALE3', type: 'stock', quantity: 10, price: 62.4 };

	it('aceita preço comum e o teto exato', () => {
		expect(invalid(CreateAssetDto, base)).toEqual([]);
		expect(
			invalid(CreateAssetDto, { ...base, price: ASSET_PRICE_MAX })
		).toEqual([]);
	});

	// TRA-276: cota de fundo e cripto de centavos ficam abaixo de R$ 0,01.
	it('aceita preço abaixo de R$ 0,01', () => {
		expect(invalid(CreateAssetDto, { ...base, price: 0.0042 })).toEqual([]);
	});

	it('recusa preço acima do teto, zero e negativo', () => {
		expect(
			invalid(CreateAssetDto, { ...base, price: ASSET_PRICE_MAX + 1 })
		).toEqual(['price']);
		expect(invalid(CreateAssetDto, { ...base, price: 0 })).toEqual(['price']);
		expect(invalid(CreateAssetDto, { ...base, price: -1 })).toEqual(['price']);
	});
});

describe('UpdateAssetDto.price (TRA-285)', () => {
	it('aplica o mesmo teto da criação', () => {
		expect(invalid(UpdateAssetDto, { price: 0.0042 })).toEqual([]);
		expect(invalid(UpdateAssetDto, { price: ASSET_PRICE_MAX + 1 })).toEqual([
			'price',
		]);
	});
});
