import { normalizeSector } from 'src/stocks/fundamentals/sector-applicability';

/**
 * Setor do ativo para persistência e exibição (TRA-144).
 *
 * ## Por que não gravar o `normalizeSector`
 *
 * `normalizeSector` existe para COMPARAÇÃO: tira acento e sobe tudo para
 * maiúscula ("Intermediários Financeiros" → "INTERMEDIARIOS FINANCEIROS"). O
 * card de exposição agrupa e rotula pelo valor persistido, então gravar a
 * chave faria o grupo aparecer gritando e sem acento. Grava-se a forma de
 * exibição; o `normalizeSector` fica para quem precisa comparar.
 *
 * ## Aplicabilidade
 *
 * Só ação e FII têm um setor econômico. ETF é cesta de vários, cripto e renda
 * fixa não têm — para eles o setor fica `null` de propósito, e o `type` do
 * ativo diz ao consumidor que é "não se aplica", não "desconhecido".
 */

const SECTOR_APPLICABLE_TYPES = new Set(['stock', 'fii']);

/**
 * Valores que as fontes devolvem no lugar de "sem dado". Gravá-los criaria um
 * grupo "-" na exposição setorial e impediria o backfill de tentar de novo.
 */
const PLACEHOLDERS = new Set([
	'-',
	'--',
	'N/A',
	'NA',
	'N/D',
	'ND',
	'NULL',
	'NONE',
	'OUTROS',
]);

export function isSectorApplicable(assetType?: string | null): boolean {
	return SECTOR_APPLICABLE_TYPES.has(String(assetType || '').toLowerCase());
}

/** Forma de exibição: espaços colapsados, capitalização e acentos originais. */
export function toDisplaySector(raw?: string | null): string | null {
	if (raw === null || raw === undefined) return null;
	const cleaned = String(raw).replace(/\s+/g, ' ').trim();
	const key = normalizeSector(cleaned);
	if (!key || PLACEHOLDERS.has(key)) return null;
	return cleaned;
}

export function resolveSectorForStorage(params: {
	assetType?: string | null;
	snapshotSector?: string | null;
}): string | null {
	if (!isSectorApplicable(params.assetType)) return null;
	return toDisplaySector(params.snapshotSector);
}
