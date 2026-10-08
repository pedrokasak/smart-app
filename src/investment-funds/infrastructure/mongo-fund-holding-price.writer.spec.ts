import type { Model } from 'mongoose';
import type { Asset } from 'src/assets/schema/assets.model';
import type { StoredFundQuote } from '../application/ports/investment-funds.ports';
import {
	CVM_QUOTE_SOURCE,
	MongoFundHoldingPriceWriter,
} from './mongo-fund-holding-price.writer';

const quote = (cnpj: string, quota: number, subclassId: string | null = null) =>
	({
		cnpj,
		subclassId,
		date: '2026-09-30',
		quota,
		netAssetValue: null,
		investorCount: null,
		sourceUrl: 'https://dados.cvm.gov.br/x.zip',
	}) satisfies StoredFundQuote;

function setup(
	holdings: Array<{ _id: string; symbol: string; price: number }>
) {
	const model = {
		find: jest.fn(() => ({
			lean: () => ({ exec: jest.fn(async () => holdings) }),
		})),
		bulkWrite: jest.fn(async (ops: unknown[]) => ({
			modifiedCount: ops.length,
		})),
		distinct: jest.fn(() => ({
			exec: jest.fn(async () => ['00017024000153']),
		})),
	};
	return {
		writer: new MongoFundHoldingPriceWriter(model as unknown as Model<Asset>),
		model,
	};
}

describe('MongoFundHoldingPriceWriter', () => {
	it('writes the CVM quota on plausible investment_fund positions only', async () => {
		const { writer, model } = setup([
			{ _id: 'a1', symbol: '00017024000153', price: 40 },
			// Valor aplicado digitado como preço da cota: fica como está.
			{ _id: 'a2', symbol: '00017024000153', price: 10_000 },
		]);

		const modified = await writer.applyQuotes([
			quote('00017024000153', 44.65),
			quote('00017024000153', 1.2, 'SUB1'), // subclasse não cota a classe
			quote('11222333000181', -0.97), // cota negativa nunca vai para a posição
		]);

		expect(modified).toBe(1);
		expect(model.find).toHaveBeenCalledWith(
			{ type: 'investment_fund', symbol: { $in: ['00017024000153'] } },
			{ symbol: 1, price: 1 }
		);
		expect(model.bulkWrite).toHaveBeenCalledWith(
			[
				{
					updateOne: {
						filter: { _id: 'a1' },
						update: {
							$set: {
								currentPrice: 44.65,
								currentPriceAt: new Date('2026-09-30T03:00:00Z'),
								currentPriceSource: CVM_QUOTE_SOURCE,
							},
						},
					},
				},
			],
			{ ordered: false }
		);
	});

	it('does nothing without usable quotes', async () => {
		const { writer, model } = setup([]);

		await expect(writer.applyQuotes([quote('x', 0)])).resolves.toBe(0);
		expect(model.find).not.toHaveBeenCalled();
	});

	it('lists the CNPJs held as investment_fund', async () => {
		const { writer, model } = setup([]);

		await expect(writer.heldCnpjs()).resolves.toEqual(['00017024000153']);
		expect(model.distinct).toHaveBeenCalledWith('symbol', {
			type: 'investment_fund',
		});
	});
});
