/**
 * Periodo de um documento de RI a partir da data de referencia (ISO
 * `AAAA-MM-DD`) ou, na falta dela, do titulo.
 *
 * Extraido do adapter do IPE (TRA-260) para que o IPE e a consulta diaria do
 * ENET produzam o mesmo periodo para o mesmo documento. O formato (mes com
 * sufixo T e ano curto, ex. "03T25") e o que o adapter ja gravava — mantido
 * para nao mudar o `period` de documentos que ja estao em cache.
 */
export function periodFromReference(
	reference: string | null | undefined,
	title: string
): string | null {
	const ref = String(reference || '').trim();
	const refMatch = ref.match(/(\d{4})[-/](\d{1,2})/);
	if (refMatch) {
		return `${refMatch[2].padStart(2, '0')}T${refMatch[1].slice(-2)}`;
	}
	const year = ref.match(/(20\d{2})/);
	if (year) return year[1];
	const quarter = String(title || '')
		.toUpperCase()
		.match(/([1-4]T\d{2})/);
	if (quarter) return quarter[1];
	return null;
}
