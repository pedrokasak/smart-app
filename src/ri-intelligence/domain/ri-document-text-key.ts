import { createHash } from 'crypto';

const CVM_HOSTS: ReadonlySet<string> = new Set([
	'www.rad.cvm.gov.br',
	'rad.cvm.gov.br',
]);
const CVM_DOWNLOAD_PATH = /\/frmDownloadDocumento\.aspx$/i;
const DIGITS = /^\d+$/;
/** Os parametros que o IPE e o ENET usam — e so eles. */
const CVM_PARAMS: ReadonlySet<string> = new Set([
	'Tela',
	'numSequencia',
	'numVersao',
	'numProtocolo',
	'descTipo',
	'CodigoInstituicao',
]);

/**
 * Chave do texto extraido de um documento de RI, pelo link BAIXADO
 * (TRA-253).
 *
 * Link oficial de download da CVM: pelos parametros que dizem QUAL arquivo a
 * CVM entrega (protocolo, sequencia e versao). O IPE e a consulta diaria do
 * ENET montam links diferentes (`/ENET/` x `/ENETWeb/`) para o mesmo
 * arquivo; pelos parametros, os dois caem na mesma chave, e o texto baixado
 * por uma fonte serve a outra. So vale com os parametros exatamente no
 * formato das duas fontes — outro `descTipo`, outra instituicao ou um
 * parametro a mais podem ser outro arquivo, e ai a chave e o proprio link.
 *
 * Qualquer outro link: o proprio link. NUNCA o `deliveryProtocol` do
 * registro: na rota HTTP ele vem do corpo da requisicao, e uma chave por ele
 * deixaria um cliente gravar o texto de um documento sob o protocolo de
 * outro — servido depois a todo mundo.
 */
export function riDocumentTextKey(link: unknown): string | null {
	const raw = String(link ?? '').trim();
	if (!raw) return null;

	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}

	const params = url.searchParams;
	const protocol = params.get('numProtocolo') ?? '';
	const sequence = params.get('numSequencia') ?? '';
	const version = params.get('numVersao') ?? '';
	const names = [...params.keys()];
	const officialCvmFile =
		// Parametro repetido: qual deles a CVM usa? Sem atalho.
		new Set(names).size === names.length &&
		names.every((name) => CVM_PARAMS.has(name)) &&
		(params.get('Tela') ?? 'ext') === 'ext' &&
		CVM_HOSTS.has(url.hostname.toLowerCase()) &&
		CVM_DOWNLOAD_PATH.test(url.pathname) &&
		DIGITS.test(protocol) &&
		DIGITS.test(sequence) &&
		DIGITS.test(version) &&
		(params.get('descTipo') ?? 'IPE') === 'IPE' &&
		(params.get('CodigoInstituicao') ?? '1') === '1';

	if (officialCvmFile) return `cvm:${protocol}:${sequence}:${version}`;
	return `url:${createHash('sha256').update(raw).digest('hex')}`;
}
