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
		private readonly primary: RiDocumentDiscoveryPort,
		private readonly fallback: RiDocumentDiscoveryPort,
		providerTimeoutMs = 5500
	) {
		this.providerTimeoutMs = providerTimeoutMs;
	}

	async discover(input: RiDocumentDiscoveryInput): Promise<RiDocumentRecord[]> {
		const [primaryDocs, fallbackDocs] = await Promise.all([
			this.safeDiscoverWithTimeout(this.primary, input),
			this.safeDiscoverWithTimeout(this.fallback, input),
		]);
		if (!primaryDocs.length) return fallbackDocs;
		if (!fallbackDocs.length) return primaryDocs;

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
