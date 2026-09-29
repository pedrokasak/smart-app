/**
 * Registro sintetico no formato da consulta externa do ENET (TRA-260),
 * reproduzindo o que a resposta real traz (conferido em 28/09/2026):
 * campos separados por `$&`, registros por `$&&*`, `<spanOrder>` com a
 * chave de ordenacao antes do texto visivel e as acoes em HTML com o
 * `OpenDownloadDocumentos(sequencia, versao, protocolo, tipo)`.
 *
 * Empresas e protocolos sao inventados.
 */
export interface EnetRowInput {
	cvmCode?: string;
	company?: string;
	category?: string;
	type?: string;
	subject?: string;
	reference?: string;
	delivered?: string;
	status?: string;
	version?: string;
	sequence?: string;
	protocol?: string;
	withDownload?: boolean;
}

export const ENET_FIELD = '$&';
export const ENET_RECORD = '$&&*';

function sortKey(dmy: string): string {
	const [day, month, year] = dmy.split(' ')[0].split('/');
	return `${year}${month}${day}`;
}

export function enetRow(input: EnetRowInput = {}): string {
	const row = {
		cvmCode: '01610-1',
		company: 'EMPRESA TESTE S.A.',
		category: 'Fato Relevante',
		type: '-',
		subject: 'Aquisição de participação',
		reference: '28/09/2026',
		delivered: '28/09/2026 09:46',
		status: 'Ativo',
		version: '1',
		sequence: '1096648',
		protocol: '1571942',
		withDownload: true,
		...input,
	};
	const actions = [
		`<i class='fi-page-search' id='VisualizarDocumento' onclick=OpenPopUpVer('frmExibirArquivoIPEExterno.aspx?NumeroProtocoloEntrega=${row.protocol}') title='Visualizar o Documento'> </i>`,
		row.withDownload
			? `<i class='fi-download' title='Download' onclick=OpenDownloadDocumentos('${row.sequence}','${row.version}','${row.protocol}','IPE')> </i>`
			: '',
	].join('');
	return [
		row.cvmCode,
		row.company,
		row.category,
		row.type,
		`<spanOrder>${row.subject}</spanOrder> - `,
		`<spanOrder>${sortKey(row.reference)}</spanOrder> ${row.reference}`,
		`<spanOrder>${sortKey(row.delivered)}</spanOrder> ${row.delivered}`,
		row.status,
		row.version,
		'AP',
		actions,
		row.subject,
	].join(ENET_FIELD);
}

export function enetDados(...rows: string[]): string {
	return rows.join(ENET_RECORD) + ENET_RECORD;
}
