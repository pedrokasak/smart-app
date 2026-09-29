/**
 * Texto ja extraido de documento de RI (TRA-253), pela chave de
 * `riDocumentTextKey`. Documento entregue a CVM nao muda: guardar o texto
 * evita baixar e extrair o PDF de novo a cada pergunta no chat ou abertura
 * na tela — e, com o texto na mao, o resumo pronto no cache e achado sem
 * esperar download nenhum.
 */
export interface RiDocumentTextCachePort {
	get(key: string): Promise<string | null>;
	set(key: string, text: string, ttlSeconds: number): Promise<void>;
}

export const RI_DOCUMENT_TEXT_CACHE = Symbol('RI_DOCUMENT_TEXT_CACHE');
