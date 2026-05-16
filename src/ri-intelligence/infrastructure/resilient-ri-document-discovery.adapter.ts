import { Injectable } from '@nestjs/common';
import {
	RiDocumentDiscoveryInput,
	RiDocumentDiscoveryPort,
} from 'src/ri-intelligence/application/ri-document-discovery.port';
import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';

@Injectable()
export class ResilientRiDocumentDiscoveryAdapter implements RiDocumentDiscoveryPort {
	private readonly providerTimeoutMs: number;

	constructor(
		private readonly cvmAdapter: RiDocumentDiscoveryPort,
		private readonly fiiAdapter: RiDocumentDiscoveryPort,
		private readonly fallbackAdapter: RiDocumentDiscoveryPort,
		providerTimeoutMs = 45000
	) {
		this.providerTimeoutMs = providerTimeoutMs;
	}

	async discover(input: RiDocumentDiscoveryInput): Promise<RiDocumentRecord[]> {
		const isFii = input.ticker.toUpperCase().endsWith('11');
		
		let primaryDocs: RiDocumentRecord[] = [];
		if (isFii) {
			primaryDocs = await this.safeDiscoverWithTimeout(this.fiiAdapter, input);
		} else {
			primaryDocs = await this.safeDiscoverWithTimeout(this.cvmAdapter, input);
		}
		const fallbackDocs = await this.safeDiscoverWithTimeout(this.fallbackAdapter, input);
		if (primaryDocs.length === 0) return fallbackDocs;
		if (fallbackDocs.length === 0) return primaryDocs;
		return this.mergeWithoutDuplicates(primaryDocs, fallbackDocs);
	}

	private async safeDiscoverWithTimeout(
		provider: RiDocumentDiscoveryPort,
		input: RiDocumentDiscoveryInput
	): Promise<RiDocumentRecord[]> {
		return Promise.race([
			this.safeDiscover(provider, input),
			new Promise<RiDocumentRecord[]>((resolve) =>
				setTimeout(() => resolve([]), this.providerTimeoutMs)
			),
		]);
	}

	private async safeDiscover(
		provider: RiDocumentDiscoveryPort,
		input: RiDocumentDiscoveryInput
	): Promise<RiDocumentRecord[]> {
		try {
			const result = await provider.discover(input);
			return Array.isArray(result) ? result : [];
		} catch {
			return [];
		}
	}

	private mergeWithoutDuplicates(
		primaryDocs: RiDocumentRecord[],
		fallbackDocs: RiDocumentRecord[]
	): RiDocumentRecord[] {
		const unique = new Map<string, RiDocumentRecord>();

		const keyOf = (document: RiDocumentRecord): string =>
			[
				String(document.ticker || '').toUpperCase(),
				String(document.documentType || ''),
				String(document.source?.value || ''),
				String(document.title || '')
					.trim()
					.toLowerCase(),
			].join('|');

		for (const document of primaryDocs) unique.set(keyOf(document), document);
		for (const document of fallbackDocs) {
			const key = keyOf(document);
			if (!unique.has(key)) unique.set(key, document);
		}

		return Array.from(unique.values());
	}
}
