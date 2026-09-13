import { PortfolioEnrichService } from './portfolio-enrich.service';

/**
 * Cobre o que TRA-144 acrescentou ao enriquecimento: o setor.
 * Serviço montado direto com dublês, sem subir o Nest.
 */

const indicators = {
	price: 38.5,
	changePercent: 1.2,
	indicators: { dividendYield: 12.4 },
};

function build(snapshot: any = { sector: 'Petróleo, Gás e Biocombustíveis' }) {
	const adapter = { getIndicators: jest.fn().mockResolvedValue(indicators) };
	const assetAdapterFactory = {
		detectAssetType: jest.fn().mockReturnValue('stock'),
		getAdapter: jest.fn().mockReturnValue(adapter),
	};
	const assetModel = {
		findByIdAndUpdate: jest
			.fn()
			.mockImplementation((_id, update) => Promise.resolve({ _id, ...update })),
	};
	const marketData = {
		getAssetSnapshot:
			snapshot instanceof Error
				? jest.fn().mockRejectedValue(snapshot)
				: jest.fn().mockResolvedValue(snapshot),
		getManyAssetSnapshots: jest.fn(),
		getDailyCloses: jest.fn().mockResolvedValue([]),
	};

	const service = new PortfolioEnrichService(
		assetAdapterFactory as any,
		assetModel as any,
		{} as any,
		marketData as any
	);

	return { service, assetModel, marketData };
}

const updateOf = (assetModel: { findByIdAndUpdate: jest.Mock }) =>
	assetModel.findByIdAndUpdate.mock.calls[0][1];

describe('PortfolioEnrichService — setor (TRA-144)', () => {
	it('grava o setor quando o ativo ainda não tem', async () => {
		const { service, assetModel } = build();

		await service.enrichAsset({ _id: 'a1', symbol: 'PETR4', type: 'stock' });

		expect(updateOf(assetModel).sector).toBe('Petróleo, Gás e Biocombustíveis');
		// O enriquecimento de sempre continua acontecendo.
		expect(updateOf(assetModel).currentPrice).toBe(38.5);
	});

	// Setor quase nunca muda: não gastar chamada numa fonte rate-limited.
	it('não consulta setor quando o ativo já tem', async () => {
		const { service, assetModel, marketData } = build();

		await service.enrichAsset({
			_id: 'a1',
			symbol: 'PETR4',
			type: 'stock',
			sector: 'Petróleo, Gás e Biocombustíveis',
		});

		expect(marketData.getAssetSnapshot).not.toHaveBeenCalled();
		expect(updateOf(assetModel)).not.toHaveProperty('sector');
	});

	it('não consulta setor para tipo sem setor', async () => {
		const { service, marketData } = build();

		await service.enrichAsset({ _id: 'a1', symbol: 'BOVA11', type: 'etf' });

		expect(marketData.getAssetSnapshot).not.toHaveBeenCalled();
	});

	// A falha é registrada, mas não derruba o enriquecimento — e não vira dado.
	it('conclui o enriquecimento sem setor quando a fonte falha', async () => {
		const { service, assetModel } = build(new Error('429'));

		await service.enrichAsset({ _id: 'a1', symbol: 'PETR4', type: 'stock' });

		expect(assetModel.findByIdAndUpdate).toHaveBeenCalled();
		expect(updateOf(assetModel)).not.toHaveProperty('sector');
		expect(updateOf(assetModel).currentPrice).toBe(38.5);
	});

	it('não grava placeholder que a fonte devolveu no lugar de "sem dado"', async () => {
		const { service, assetModel } = build({ sector: '-' });

		await service.enrichAsset({ _id: 'a1', symbol: 'PETR4', type: 'stock' });

		expect(updateOf(assetModel)).not.toHaveProperty('sector');
	});
});
