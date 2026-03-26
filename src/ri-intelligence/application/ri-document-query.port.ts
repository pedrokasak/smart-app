import { RiComparableDocumentInput } from 'src/ri-intelligence/application/ri-comparison.types';

export const RI_DOCUMENT_QUERY = Symbol('RI_DOCUMENT_QUERY');

export interface RiDocumentQueryPort {
	getLatestByTicker(ticker: string): Promise<RiComparableDocumentInput | null>;
	getPreviousComparable(
		current: RiComparableDocumentInput
	): Promise<RiComparableDocumentInput | null>;
}
