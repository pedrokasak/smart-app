export const RI_DOCUMENT_CONTENT = Symbol('RI_DOCUMENT_CONTENT');

export interface RiDocumentContentResult {
	/** Texto extraído do documento, ou null quando não foi possível obter. */
	text: string | null;
	/** Motivo da falha, pra observabilidade — nunca lançado ao chamador. */
	reason?:
		| 'empty_url'
		| 'link_invalid'
		| 'not_pdf'
		| 'too_large'
		| 'fetch_failed'
		| 'extract_failed'
		| 'empty_after_extract';
	/** Bytes baixados, quando aplicável. */
	bytes?: number;
}

/**
 * Busca e extrai o texto de um documento de RI a partir da sua URL (TRA-85).
 *
 * Existe porque o web NAO consegue buscar o PDF do site de RI (CORS em
 * dominio externo), entao a extracao tem que ser server-side. Sem isto, o
 * fluxo de resumo nunca recebia o conteudo real e todo resumo caia no
 * fallback de metadados.
 */
export interface RiDocumentContentPort {
	fetchTextContent(url: string): Promise<RiDocumentContentResult>;
}
