/**
 * Periodo de um documento de RI a partir do titulo ou da data de referencia
 * (ISO `AAAA-MM-DD`).
 *
 * Extraido do adapter do IPE (TRA-260) para que o IPE e a consulta diaria do
 * ENET produzam o mesmo periodo para o mesmo documento.
 *
 * O formato e o do mercado: trimestre com sufixo T e ano curto ("2T26").
 * Antes saia o MES ("06T26" para 2026-06-30), que nao diz nada ao usuario e
 * que `inferQuarterFromDocument` nao reconhece (TRA-277).
 *
 * Ordem:
 *  1. Trimestre escrito no titulo ("... 2T26 ..."): e o que a empresa diz.
 *  2. Data de referencia no fim de um trimestre (31/03, 30/06, 30/09, 31/12).
 *     Demonstracoes, releases e ITRs usam essa data.
 *  3. Referencia que so tem o ano ("Exercicio 2025").
 *
 * Data de referencia fora do fim de trimestre (ata, aviso, posicao mensal)
 * e a data do evento, nao um periodo: devolve null em vez de inventar um.
 */
const QUARTER_END: Record<string, number> = {
	'03-31': 1,
	'06-30': 2,
	'09-30': 3,
	'12-31': 4,
};

export function periodFromReference(
	reference: string | null | undefined,
	title: string
): string | null {
	const fromTitle = String(title || '')
		.toUpperCase()
		.match(/(?:^|[^0-9])([1-4]T\d{2})(?![0-9])/);
	if (fromTitle) return fromTitle[1];

	const ref = String(reference || '').trim();
	const date = ref.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (date) {
		const quarter = QUARTER_END[`${date[2]}-${date[3]}`];
		return quarter ? `${quarter}T${date[1].slice(-2)}` : null;
	}
	const year = ref.match(/(20\d{2})/);
	if (year) return year[1];
	return null;
}
