import type { RagIngestItem } from 'src/ai/rag-ingestion/application/rag-ingestion.port';
import { positionName } from 'src/fixed-income/domain/position-naming';
import {
	FIXED_INCOME_ASSET_TYPE,
	type FixedIncomeAssetData,
} from 'src/fixed-income/domain/fixed-income-asset';

/**
 * Um chunk por posição de renda fixa (ADR-002, TRA-16). O texto usa o nome
 * canônico montado pelo server a partir de tipo, taxa e vencimento: o texto
 * livre que a pessoa digitou (`label`, nome do ativo) nunca entra, porque o
 * chunk sai do país para o embedding.
 *
 * Valores em reais cheios, como nos outros fatos (TRA-74): centavo de
 * marcação diária não pode mudar o hash todo dia.
 */

export interface FixedIncomeFactAsset {
	id?: string;
	_id?: unknown;
	type?: string;
	fixedIncome?: FixedIncomeAssetData | null;
}

const reais = (value: number) => Math.round(value).toLocaleString('pt-BR');

const brDate = (iso: string) => {
	const [year, month, day] = iso.slice(0, 10).split('-');
	return `${day}/${month}/${year}`;
};

function assetId(asset: FixedIncomeFactAsset): string | null {
	const raw = asset.id ?? asset._id;
	return raw ? String(raw) : null;
}

export function buildFixedIncomeItems(
	assets: FixedIncomeFactAsset[],
	asOf: string
): RagIngestItem[] {
	const items: RagIngestItem[] = [];
	for (const asset of assets) {
		const data = asset.fixedIncome;
		const id = assetId(asset);
		if (asset.type !== FIXED_INCOME_ASSET_TYPE || !data || !id) continue;

		const applied = `Aplicado R$ ${reais(data.principal)} em ${brDate(data.appliedAt)}.`;
		const valuation = data.valuation;
		const marked = valuation
			? ` Valor bruto R$ ${reais(valuation.grossValue)}, líquido de impostos R$ ${reais(valuation.netValue)} (marcado em ${brDate(valuation.valuedAt)}).`
			: ' Ainda sem marcação na curva.';

		items.push({
			sourceType: 'portfolio_fixed_income',
			sourceId: `fixed_income:${id}`,
			content: `Renda fixa: ${positionName(data)}. ${applied}${marked}`,
			metadata: { kind: data.kind, indexer: data.indexer },
			asOf,
		});
	}
	return items.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}
