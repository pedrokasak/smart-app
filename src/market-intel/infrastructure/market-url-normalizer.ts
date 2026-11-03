import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { MarketUrlNormalizer } from 'src/market-intel/application/market-intel.ports';

/** Parâmetros de tracking a remover da URL. */
const TRACKING_PARAMS = new Set([
	'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
	'utm_id', 'ref', 'fbclid', 'gclid', 'mc_cid', 'mc_eid',
]);

/**
 * Stop words em português para tokenização do SimHash.
 * Lista mínima — só as mais frequentes.
 */
const STOP_WORDS = new Set([
	'a', 'as', 'o', 'os', 'um', 'uma', 'uns', 'umas',
	'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
	'ao', 'aos', 'à', 'às', 'com', 'por', 'para', 'que', 'se',
	'e', 'é', 'são', 'foi', 'ser', 'ter', 'tem', 'está', 'estão',
	'mais', 'mas', 'não', 'ou', 'já', 'ainda', 'também',
]);

@Injectable()
export class MarketUrlNormalizerImpl implements MarketUrlNormalizer {
	canonicalize(url: string): string {
		let parsed: URL;
		try {
			// Unicode NFC antes de parsear
			parsed = new URL(url.normalize('NFC'));
		} catch {
			return url.normalize('NFC').toLowerCase();
		}

		// Remove tracking params
		for (const key of [...parsed.searchParams.keys()]) {
			if (TRACKING_PARAMS.has(key)) parsed.searchParams.delete(key);
		}

		// Ordena params restantes para canonical ordering
		parsed.searchParams.sort();

		// Remove trailing slash do pathname (exceto root)
		if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
			parsed.pathname = parsed.pathname.slice(0, -1);
		}

		// protocol e host já vêm lowercase do parser WHATWG URL; preserva path case (case-sensitive)
		return `${parsed.protocol}//${parsed.host}${parsed.pathname}${
			parsed.search
		}`.normalize('NFC');
	}

	urlHash(canonicalUrl: string): string {
		return createHash('sha256').update(canonicalUrl, 'utf8').digest('hex');
	}

	contentHash(title: string, description: string): string {
		const normalized = (title + '\n' + description)
			.normalize('NFC')
			.toLowerCase()
			.replace(/\s+/g, ' ')
			.trim();
		return createHash('sha256').update(normalized, 'utf8').digest('hex');
	}

	tokenize(text: string): string[] {
		return text
			.normalize('NFC')
			.toLowerCase()
			.replace(/[^a-záàâãéèêíïóôõöúüçñ\s]/gi, ' ')
			.split(/\s+/)
			.filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
	}
}

/**
 * Calcula SimHash de 64 bits (representado como string decimal do BigInt).
 *
 * Algoritmo:
 * 1. Hash MD5 de cada token (64 bits usados)
 * 2. Acumula vetor de 64 pesos
 * 3. Bit i = 1 se peso[i] > 0
 *
 * Distância de Hamming ≤ 3 = documentos similares (ADR-004 seção 7).
 */
export function computeSimHash(tokens: string[]): bigint {
	const weights = new Array<number>(64).fill(0);

	for (const token of tokens) {
		const hash = createHash('md5').update(token, 'utf8').digest();
		// Usa os primeiros 8 bytes (64 bits)
		let bits = BigInt(0);
		for (let b = 0; b < 8; b++) {
			bits = (bits << BigInt(8)) | BigInt(hash[b]);
		}
		for (let i = 0; i < 64; i++) {
			const bit = (bits >> BigInt(63 - i)) & BigInt(1);
			weights[i] += bit === BigInt(1) ? 1 : -1;
		}
	}

	let simhash = BigInt(0);
	for (let i = 0; i < 64; i++) {
		if (weights[i] > 0) {
			simhash |= BigInt(1) << BigInt(63 - i);
		}
	}
	return simhash;
}

/** Distância de Hamming entre dois SimHashes de 64 bits. */
export function hammingDistance(a: bigint, b: bigint): number {
	let xor = a ^ b;
	let count = 0;
	while (xor !== BigInt(0)) {
		count += Number(xor & BigInt(1));
		xor >>= BigInt(1);
	}
	return count;
}
