export const RI_DOCUMENT_LINK_RESOLVER = Symbol('RI_DOCUMENT_LINK_RESOLVER');

export interface ResolveRiDocumentLinkInput {
	url: string;
	origin?: string;
}

export interface ResolveRiDocumentLinkResult {
	isValid: boolean;
	resolvedUrl: string | null;
	statusCode: number | null;
	contentType: string | null;
	rejectionReason?:
		| 'empty_url'
		| 'invalid_url'
		| 'relative_url_without_origin'
		| 'unreachable'
		| 'invalid_http_status'
		| 'known_error_route'
		| 'invalid_content_type';
}

export interface RiDocumentLinkResolverPort {
	resolve(input: ResolveRiDocumentLinkInput): Promise<ResolveRiDocumentLinkResult>;
}
