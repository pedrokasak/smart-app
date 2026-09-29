/**
 * Acervo de documentos de RI no trackerr-ia (TRA-264): o texto de cada
 * documento em chunks por pagina, para responder "o que a empresa disse
 * sobre X" citando documento e pagina.
 */
export interface RiKnowledgeDocument {
	/** Identidade estavel do documento (a chave do vigia de RI). */
	key: string;
	/** Codigo do emissor (`issuerBaseCode`): o filtro de toda busca. */
	issuer: string;
	ticker: string;
	company: string;
	title: string;
	category: string | null;
	documentType: string | null;
	period: string | null;
	/** Dia da entrega, `AAAA-MM-DD`. */
	publishedAt: string;
	sourceUrl: string;
}

export type RiKnowledgeIndexStatus = 'indexed' | 'unchanged' | 'empty';

export interface RiKnowledgeCitation {
	documentKey: string;
	title: string;
	category: string | null;
	period: string | null;
	/** Dia da entrega, `AAAA-MM-DD`. */
	publishedAt: string;
	sourceUrl: string;
	/** Pagina do PDF; null quando o texto nao tinha marcador de pagina. */
	page: number | null;
	/** Trecho do PROPRIO documento que sustenta a afirmacao. */
	excerpt: string;
}

export interface RiKnowledgeAnswer {
	items: { text: string; citation: RiKnowledgeCitation }[];
	/** Nenhuma afirmacao sustentada pelos documentos. */
	notFound: boolean;
}

export interface RiKnowledgeQuestion {
	issuer: string;
	question: string;
	/** So documentos entregues a partir deste dia (`AAAA-MM-DD`). */
	publishedAfter?: string | null;
}

export interface RiKnowledgePort {
	index(
		document: RiKnowledgeDocument,
		content: string
	): Promise<RiKnowledgeIndexStatus>;
	ask(question: RiKnowledgeQuestion): Promise<RiKnowledgeAnswer>;
}

export const RI_KNOWLEDGE = Symbol('RI_KNOWLEDGE');
