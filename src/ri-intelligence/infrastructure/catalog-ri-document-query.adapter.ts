import { Injectable } from '@nestjs/common';
import { RiComparableDocumentInput } from 'src/ri-intelligence/application/ri-comparison.types';
import { RiDocumentCatalogService } from 'src/ri-intelligence/application/ri-document-catalog.service';
import { RiDocumentQueryPort } from 'src/ri-intelligence/application/ri-document-query.port';
import { RiDocumentType } from 'src/ri-intelligence/domain/ri-document.types';

@Injectable()
export class CatalogRiDocumentQueryAdapter implements RiDocumentQueryPort {
	constructor(private readonly catalogService: RiDocumentCatalogService) {}

	async getLatestByTicker(
		ticker: string
	): Promise<RiComparableDocumentInput | null> {
		const selected = await this.catalogService.retrieveMostRelevantDocument({
			ticker,
			documentType: 'earnings_release',
		});
		if (selected.status === 'found' && selected.document) {
			return {
				document: selected.document,
				content: null,
			};
		}

		const fallback = await this.catalogService.retrieveMostRelevantDocument({
			ticker,
		});
		if (fallback.status !== 'found' || !fallback.document) return null;

		return {
			document: fallback.document,
			content: null,
		};
	}

	async getPreviousComparable(
		current: RiComparableDocumentInput
	): Promise<RiComparableDocumentInput | null> {
		const ticker = String(current?.document?.ticker || '').trim();
		if (!ticker) return null;

		const sameType = (current?.document?.documentType ||
			'earnings_release') as RiDocumentType;
		const result = await this.catalogService.search({
			query: ticker,
			documentType: sameType,
			limit: 40,
		});
		if (!result.documents.length) return null;

		const currentPublishedAt = new Date(
			String(current.document.publishedAt || '')
		).getTime();
		const previous = result.documents.find((document) => {
			if (document.id === current.document.id) return false;
			const publishedAt = new Date(document.publishedAt).getTime();
			if (!Number.isFinite(publishedAt)) return false;
			if (!Number.isFinite(currentPublishedAt)) return true;
			return publishedAt < currentPublishedAt;
		});
		if (!previous) return null;

		return {
			document: previous,
			content: null,
		};
	}
}
