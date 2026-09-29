import { normalizeCvmCode } from 'src/ri-intelligence/domain/cvm-code';
import { RiDelivery } from 'src/ri-intelligence/watch/domain/ri-delivery';

/**
 * Leitura do campo `dados` da consulta externa do ENET (TRA-260).
 *
 * O formato nao e documentado: e o que a propria pagina da CVM consome
 * (`frmConsultaExternaCVM.aspx/ListarDocumentos`). Conferido em 28/09/2026:
 *
 *   0 codigo CVM ("01610-1")      6 entrega (<spanOrder>AAAAMMDD</spanOrder> DD/MM/AAAA HH:MM)
 *   1 companhia                   7 situacao ("Ativo")
 *   2 categoria                   8 versao
 *   3 tipo ("-" quando vazio)     9 modalidade
 *   4 assunto com sufixo " - "    10 acoes em HTML (OpenDownloadDocumentos)
 *   5 referencia (<spanOrder>)    11 assunto
 *
 * Tudo que nao casa com esse formato e descartado linha a linha — uma
 * mudanca de layout vira "nenhum documento", nunca um documento errado.
 */
const FIELD_SEPARATOR = '$&';
const RECORD_SEPARATOR = '$&&*';
const MIN_FIELDS = 11;

const DOWNLOAD_ACTION =
	/OpenDownloadDocumentos\('(\d+)','(\d+)','(\d+)','([A-Z]+)'\)/;
const SORT_KEY_DATE = /<spanOrder>\s*(\d{4})(\d{2})(\d{2})\s*<\/spanOrder>/i;
const DOWNLOAD_BASE =
	'https://www.rad.cvm.gov.br/ENETWeb/frmDownloadDocumento.aspx';

function text(value: string | undefined): string {
	return String(value ?? '')
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function optionalText(value: string | undefined): string | null {
	const cleaned = text(value)
		.replace(/\s*-\s*$/, '')
		.trim();
	return cleaned && cleaned !== '-' ? cleaned : null;
}

function isoDate(value: string | undefined): string | null {
	const match = SORT_KEY_DATE.exec(String(value ?? ''));
	return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function parseRow(row: string): RiDelivery | null {
	const fields = row.split(FIELD_SEPARATOR);
	if (fields.length < MIN_FIELDS) return null;

	const cvmCode = normalizeCvmCode(fields[0]);
	const deliveredOn = isoDate(fields[6]);
	const download = DOWNLOAD_ACTION.exec(fields[10] ?? '');
	if (!cvmCode || !deliveredOn || !download) return null;

	const [, sequence, version, protocol, kind] = download;
	const query = new URLSearchParams({
		Tela: 'ext',
		numSequencia: sequence,
		numVersao: version,
		numProtocolo: protocol,
		descTipo: kind,
		CodigoInstituicao: '1',
	});

	return {
		cvmCode,
		company: text(fields[1]),
		category: text(fields[2]),
		type: optionalText(fields[3]),
		subject: optionalText(fields[11]) ?? optionalText(fields[4]),
		referenceDate: isoDate(fields[5]),
		deliveredOn,
		protocol,
		downloadUrl: `${DOWNLOAD_BASE}?${query.toString()}`,
		active: /^ativo$/i.test(text(fields[7])),
	};
}

export function parseEnetDeliveries(dados: string): RiDelivery[] {
	return String(dados ?? '')
		.split(RECORD_SEPARATOR)
		.filter((row) => row.trim())
		.map(parseRow)
		.filter((delivery): delivery is RiDelivery => delivery !== null);
}
