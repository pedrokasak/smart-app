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
		private readonly httpAdapter: RiDocumentDiscoveryPort,
		private readonly cvmAdapter: RiDocumentDiscoveryPort,
		private readonly fiiAdapter: RiDocumentDiscoveryPort,
		private readonly fallbackAdapter: RiDocumentDiscoveryPort,
		providerTimeoutMs = 45000
	) {
		this.providerTimeoutMs = providerTimeoutMs;
	}

	async discover(input: RiDocumentDiscoveryInput): Promise<RiDocumentRecord[]> {
		const isFii = input.ticker.toUpperCase().endsWith('11');

		// O catálogo em memória saiu da cadeia: as URLs dele eram inventadas,
		// não curadas. Conferidas uma a uma, as quatro respondem 404 — o link
		// do BBAS3 seguia o padrão de WordPress (`ri.bb.com.br/wp-content/...`)
		// enquanto o arquivo real mora no gerenciador da MZ (`api.mziq.com`),
		// e Petrobras, Vale e Bradesco tinham caminhos igualmente plausíveis e
		// igualmente inexistentes.
		//
		// Pior: ele era MESCLADO com os adapters reais e entrava primeiro na
		// deduplicação, então um documento verdadeiramente descoberto podia ser
		// ofuscado por um link morto. É a razão de o RI Inteligente "nunca ter
		// funcionado direito": a descoberta real existe, mas o resultado vinha
		// contaminado por documentos que nunca existiram.
		//
		// A descoberta de verdade fica com HTTP, CVM, FII e Puppeteer. Sem
		// resultado, a resposta é vazia — que é honesto, e visivelmente
		// diferente de um link que quebra ao clicar.

		// Primário: para FIIs, o adapter específico; para ações, o adapter HTTP
		// (bate RI sites estáticos, mais rápido que Puppeteer).
		//
		// A CVM entra SEMPRE para ações, não só quando o HTTP volta vazio.
		// Antes ela era segundo nível — e isso deixava a fonte mais confiável
		// de fora justamente quando ela era mais necessária: para BBAS3 o
		// Puppeteer devolve 20 links, todos páginas de evento em HTML que a
		// validação descarta depois, então "descoberta encontrou algo" era
		// verdade e "encontramos documento" não. A CVM nunca era consultada e
		// o resultado final era zero.
		//
		// Descobrir e validar são etapas separadas: número de links achados não
		// diz nada sobre quantos são arquivo de verdade. Quem decide é a
		// validação, adiante — aqui o certo é oferecer todas as fontes.
		let primaryDocs: RiDocumentRecord[] = [];
		if (isFii) {
			primaryDocs = await this.safeDiscoverWithTimeout(this.fiiAdapter, input);
		} else {
			const [httpDocs, cvmDocs] = await Promise.all([
				this.safeDiscoverWithTimeout(this.httpAdapter, input),
				this.safeDiscoverWithTimeout(this.cvmAdapter, input),
			]);
			primaryDocs = this.mergeWithoutDuplicates(httpDocs, cvmDocs);
		}

		const fallbackDocs = await this.safeDiscoverWithTimeout(
			this.fallbackAdapter,
			input
		);
		// Funde primário + fallback sem duplicatas: uma fonte pode ter o título
		// do release de hoje e outra os PDFs históricos — juntamos as duas para
		// a seleção de "resultado do trimestre atual" não perder o documento
		// novo.
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
