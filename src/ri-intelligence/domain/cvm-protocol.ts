import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';

const LINK_PROTOCOL = /[?&]numProtocolo=(\d+)/i;

/**
 * Protocolo de entrega de um documento da CVM (TRA-260): a identidade do
 * documento em qualquer fonte da CVM, enquanto link, titulo e id mudam de
 * uma fonte para outra. Vem do campo do registro ou, na falta dele, do link
 * de download do ENET.
 */
export function cvmDeliveryProtocol(
	record:
		| Pick<RiDocumentRecord, 'deliveryProtocol' | 'source'>
		| null
		| undefined
): string | null {
	const explicit = String(record?.deliveryProtocol ?? '').replace(/\D/g, '');
	return explicit || protocolFromCvmLink(record?.source?.value);
}

/**
 * O parametro `numProtocolo` do link de download do ENET: o mesmo no link do
 * dataset IPE e no que a consulta diaria monta (conferido em 25/09/2026: os
 * 99 documentos do IPE achados no ENET tinham o mesmo `numProtocolo`, a
 * mesma versao e o mesmo codigo CVM). O `Protocolo_Entrega` do IPE e OUTRO
 * identificador (26 digitos) e nao serve para casar as fontes.
 */
export function protocolFromCvmLink(link: unknown): string | null {
	const match = LINK_PROTOCOL.exec(String(link ?? ''));
	return match ? match[1] : null;
}
