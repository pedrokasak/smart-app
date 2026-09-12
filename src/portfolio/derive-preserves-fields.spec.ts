import {
	withDerivedAveragePrice,
	type DerivableAsset,
} from './derive-average-price';
import { AssetMapper } from 'src/assets/mappers/asset.mapper';

/**
 * A carteira específica voltava zerada enquanto "todas as carteiras"
 * mostrava os valores certos.
 *
 * Causa: `GET /portfolio/:id` chamava `withDerivedAveragePrice` com os
 * documentos do Mongoose e só depois mapeava para DTO. Quando a derivação
 * de fato recalcula, ela devolve `{ ...asset }` — e espalhar um documento
 * do Mongoose copia `$__` e `_doc`, não `symbol` nem `_id`. O mapper
 * seguinte recebia objetos vazios.
 *
 * `GET /portfolio/assets` nunca quebrou porque mapeava primeiro, o que
 * explica a assimetria que o usuário viu na tela.
 */

/** Imita a forma de um documento do Mongoose: campos atrás de `_doc`. */
class FakeMongooseDoc {
	$__ = { activePaths: {} };
	$isNew = false;
	_doc: Record<string, unknown>;

	constructor(fields: Record<string, unknown>) {
		this._doc = fields;
		Object.assign(this, fields);
	}
}

describe('derivação preserva os campos do ativo', () => {
	it('mantém os campos ao recalcular sobre um objeto simples', () => {
		const [result] = withDerivedAveragePrice<DerivableAsset & any>(
			[{ symbol: 'PETR4', id: 'a1', quantity: 10, total: 300 }],
			[
				{
					symbol: 'PETR4',
					side: 'buy',
					quantity: 10,
					price: 30,
					fees: 0,
					date: new Date('2025-01-10'),
				},
			]
		);

		expect(result.symbol).toBe('PETR4');
		expect(result.id).toBe('a1');
		expect(result.quantity).toBe(10);
		expect(result.avgPrice).toBeCloseTo(30, 6);
	});

	it('espalhar um documento do Mongoose perde os campos — por isso mapeamos antes', () => {
		const doc = new FakeMongooseDoc({ symbol: 'PETR4', quantity: 10 });
		const spread = { ...(doc as any) };

		// O documento em si expõe os campos...
		expect((doc as any).symbol).toBe('PETR4');
		// ...mas o espalhamento carrega as propriedades internas junto, que é
		// o que envenenava o mapper seguinte.
		expect(Object.keys(spread)).toEqual(
			expect.arrayContaining(['$__', '_doc'])
		);
	});

	it('mapear para DTO antes de derivar preserva o ativo inteiro', () => {
		// Caminho correto, igual ao de findAllAssets.
		const mongooseLike = {
			_id: { toString: () => 'asset-1' },
			portfolioId: { toString: () => 'port-1' },
			symbol: 'PETR4',
			type: 'stock',
			quantity: 10,
			price: 30,
			total: 300,
			currentPrice: 30,
			change24h: 0,
			indicators: {},
			source: 'b3',
		};

		const dtos = AssetMapper.toResponseDtoArray([mongooseLike] as any);
		const [result] = withDerivedAveragePrice<any>(dtos, [
			{
				symbol: 'PETR4',
				side: 'buy',
				quantity: 10,
				price: 25,
				fees: 0,
				date: new Date('2025-01-10'),
			},
		]);

		// O que a tela precisa continua lá depois da derivação.
		expect(result.id).toBe('asset-1');
		expect(result.symbol).toBe('PETR4');
		expect(result.quantity).toBe(10);
		expect(result.total).toBe(300);
		expect(result.avgPrice).toBeCloseTo(25, 6);
	});

	it('preserva os campos também no caminho do custo corrompido', () => {
		// Este caminho também devolve `{ ...asset }`, então corria o mesmo
		// risco — e é exatamente o caso de quem importou o consolidado.
		const [result] = withDerivedAveragePrice<any>(
			[
				{
					id: 'asset-2',
					symbol: 'BEEF3',
					quantity: 46,
					total: 264.96,
					avgPrice: 5.76,
					price: 5.76,
					source: 'b3',
				},
			],
			[]
		);

		expect(result.id).toBe('asset-2');
		expect(result.symbol).toBe('BEEF3');
		expect(result.quantity).toBe(46);
		expect(result.total).toBe(264.96);
		expect(result.avgPrice).toBeUndefined();
	});
});
