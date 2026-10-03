import { FiiFiling } from 'src/ri-intelligence/watch/domain/fii-filing';

/** Download do documento na FundosNet: PDF, ou XML quando estruturado. */
export const FUNDOSNET_DOWNLOAD_URL =
	'https://fnet.bmfbovespa.com.br/fnet/publico/downloadDocumento';

/** Uma linha da listagem da FundosNet (`pesquisarGerenciadorDocumentosDados`). */
interface FundosNetRow {
	id?: unknown;
	descricaoFundo?: unknown;
	categoriaDocumento?: unknown;
	tipoDocumento?: unknown;
	especieDocumento?: unknown;
	dataEntrega?: unknown;
	dataReferencia?: unknown;
	status?: unknown;
}

function text(value: unknown): string {
	return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function optionalText(value: unknown): string | null {
	return text(value) || null;
}

/** "03/10/2026 08:49" (Brasilia) -> "2026-10-03". */
function deliveryDay(value: unknown): string | null {
	const match = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(text(value));
	return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

/** "30/06/2026" -> "2026-06-30"; "08/2026" (mes) -> "2026-08-01". */
function referenceDay(value: unknown): string | null {
	const raw = text(value);
	const day = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
	if (day) return `${day[3]}-${day[2]}-${day[1]}`;
	const month = /^(\d{2})\/(\d{4})$/.exec(raw);
	if (month) return `${month[2]}-${month[1]}-01`;
	return null;
}

/**
 * Le a listagem da FundosNet (TRA-266) sem confiar nela: linha sem id, sem
 * categoria ou sem data de entrega legivel sai. Verificado ao vivo em
 * 03/10/2026:
 * - `status` "AC" e o documento vigente; "IC" e a versao substituida;
 * - `arquivoEstruturado` vem " " ate nos XMLs, por isso o informe
 *   estruturado e reconhecido pelo nome da categoria ou do tipo.
 */
export function parseFundosNetFilings(rows: unknown): FiiFiling[] {
	if (!Array.isArray(rows)) return [];
	const filings: FiiFiling[] = [];
	for (const row of rows as FundosNetRow[]) {
		const id = String(row?.id ?? '').trim();
		const category = text(row?.categoriaDocumento);
		const deliveredOn = deliveryDay(row?.dataEntrega);
		if (!/^\d+$/.test(id) || !category || !deliveredOn) continue;
		const type = optionalText(row?.tipoDocumento);
		filings.push({
			id,
			fund: text(row?.descricaoFundo),
			category,
			type,
			species: optionalText(row?.especieDocumento),
			referenceDate: referenceDay(row?.dataReferencia),
			deliveredOn,
			downloadUrl: `${FUNDOSNET_DOWNLOAD_URL}?id=${id}`,
			active: text(row?.status) === 'AC',
			structured: /estruturad/i.test(`${category} ${type ?? ''}`),
		});
	}
	return filings;
}
