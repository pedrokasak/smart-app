import { HttpService } from '@nestjs/axios';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import yauzl from 'yauzl';
import Papa from 'papaparse';
import {
	RiDocumentDiscoveryInput,
	RiDocumentDiscoveryPort,
} from 'src/ri-intelligence/application/ri-document-discovery.port';
import {
	RI_ISSUER_CATALOG,
	RiIssuerCatalogPort,
} from 'src/ri-intelligence/application/ri-issuer-catalog.port';
import { classifyRiDocumentType } from 'src/ri-intelligence/domain/ri-document-classifier';
import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';

/**
 * Descoberta de documentos corporativos via dataset IPE da CVM
 * (`dados.cvm.gov.br/.../DOC/IPE/DADOS/ipe_cia_aberta_AAAA.zip`).
 *
 * O IPE é o dataset certo para descoberta: cada linha é um documento submetido
 * com data de entrega e um `Link_Download` direto para o ENET. Diferente do
 * `CvmOpenDataAdapter` (que lê DFP `.csv` direto), o IPE só vem em `.zip` com
 * um CSV interno `ipe_cia_aberta_AAAA.csv` (delimitador `;`).
 *
 * Fluxo:
 *  1. `issuerCatalog.resolveByTicker` → CNPJ (a CVM filtra por CNPJ, não ticker).
 *     Sem CNPJ, retorna [] (não dá para filtar server-side).
 *  2. Determina anos candidatos dado `[dateFrom, dateTo]` (ou últimos N quando
 *     ausente), baixa os zips relevantes.
 *  3. Streaming unzip via yauzl sobre o buffer (`responseType: 'arraybuffer'`),
 *     lê o CSV interno com Papa.parse, filtra por CNPJ normalizado + janela.
 *  4. Compõe `title = Categoria + ' - ' + Tipo + ' - ' + Especie + ' - ' + Assunto`
 *     antes de `classifyRiDocumentType` (o classifier opera por aliases de
 *     keywords sobre o title), mapeia para `RiDocumentRecord`.
 *
 * Cache `textCache` + `inflight` por ano (TTL 6h), como `CvmOpenDataAdapter`.
 */
@Injectable()
export class CvmRiDocumentDiscoveryAdapter implements RiDocumentDiscoveryPort {
	private readonly logger = new Logger(CvmRiDocumentDiscoveryAdapter.name);
	private readonly baseUrl =
		'https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/IPE/DADOS';
	private readonly textCache = new Map<
		string,
		{ expiresAt: number; rows: Record<string, string>[] }
	>();
	private readonly inflight = new Map<
		string,
		Promise<Record<string, string>[]>
	>();
	private readonly ttlMs = 6 * 60 * 60 * 1000;
	private readonly defaultYearsBack = 3;
	private readonly maxDocuments = 40;

	constructor(
		private readonly httpService: HttpService,
		@Inject(RI_ISSUER_CATALOG)
		private readonly issuerCatalog: RiIssuerCatalogPort
	) {}

	async discover(input: RiDocumentDiscoveryInput): Promise<RiDocumentRecord[]> {
		const ticker = String(input.ticker || '')
			.trim()
			.toUpperCase()
			.replace(/\.SA$/i, '');
		if (!ticker) return [];

		const issuer = await this.issuerCatalog.resolveByTicker(ticker);
		if (!issuer?.cnpj) {
			return [];
		}
		const normalizedCnpj = this.normalizeCnpj(issuer.cnpj);

		const years = this.resolveCandidateYears(input.dateFrom, input.dateTo);
		const rowSets = await Promise.all(
			years.map((year) => this.safeLoadIpeRows(year))
		);
		const allRows = rowSets.flat();

		const fromMs = this.toEpochMs(input.dateFrom);
		const toMs = this.toEpochMs(input.dateTo);

		const matching = allRows.filter((row) => {
			if (this.normalizeCnpj(row.CNPJ_Companhia) !== normalizedCnpj)
				return false;
			const entregaMs = this.parseDateMs(row.Data_Entrega);
			if (entregaMs === null) return false;
			if (fromMs !== null && entregaMs < fromMs) return false;
			if (toMs !== null && entregaMs > toMs) return false;
			return true;
		});

		if (!matching.length) return [];

		// Deduplica por Link_Download: o mesmo documento ENET pode aparecer em
		// mais de um arquivo anual do IPE (ex.: resubmissão com versão
		// incrementada ainda compartilha o link). Colapsa para um registro por
		// link, mantendo a primeira ocorrência — evita retornar o mesmo fato
		// relevante/release N vezes apenas porque múltiplos zips o contêm.
		const seenLinks = new Set<string>();
		const dedupedMatching = matching.filter((row) => {
			const link = String(row.Link_Download || '').trim();
			if (!link) return true; // linhas sem link serão descartadas no toRecord
			if (seenLinks.has(link)) return false;
			seenLinks.add(link);
			return true;
		});

		const records = dedupedMatching
			.map((row, index) => this.toRecord(row, ticker, issuer.company, index))
			.filter((record): record is RiDocumentRecord => Boolean(record))
			.sort(
				(a, b) =>
					new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
			)
			.slice(0, this.maxDocuments);

		return records;
	}

	private toRecord(
		row: Record<string, string>,
		ticker: string,
		company: string,
		index: number
	): RiDocumentRecord | null {
		const link = String(row.Link_Download || '').trim();
		const entregaIso = this.parseDateIso(row.Data_Entrega);
		if (!link || !entregaIso) return null;

		const categoria = String(row.Categoria || '').trim();
		const tipo = String(row.Tipo || '').trim();
		const especie = String(row.Especie || '').trim();
		const assunto = String(row.Assunto || '').trim();
		const title = [categoria, tipo, especie, assunto]
			.filter(Boolean)
			.join(' - ');

		const classified = classifyRiDocumentType({ title, url: link });

		return {
			id: `${ticker}:${classified.documentType}:${entregaIso}:${index}:cvm`,
			ticker,
			company,
			title,
			documentType: classified.documentType,
			period: this.extractPeriod(row, title),
			publishedAt: entregaIso,
			source: {
				type: 'url',
				value: link,
			},
			classification: {
				method: 'deterministic_rules',
				confidence: classified.confidence,
				score: classified.score,
				matchedAliases: classified.matchedAliases,
			},
			contentStatus: 'metadata_only',
		} satisfies RiDocumentRecord;
	}

	private extractPeriod(
		row: Record<string, string>,
		title: string
	): string | null {
		const ref = String(row.Data_Referencia || '').trim();
		const refMatch = ref.match(/(\d{4})[-/](\d{1,2})/);
		if (refMatch) {
			return `${refMatch[2].padStart(2, '0')}T${refMatch[1].slice(-2)}`;
		}
		const year = ref.match(/(20\d{2})/);
		if (year) return year[1];
		const quarter = String(title || '')
			.toUpperCase()
			.match(/([1-4]T\d{2})/);
		if (quarter) return quarter[1];
		return null;
	}

	private resolveCandidateYears(
		dateFrom?: string | Date,
		dateTo?: string | Date
	): number[] {
		const currentYear = new Date().getFullYear();
		const from = this.toYear(dateFrom);
		const to = this.toYear(dateTo);
		if (from === null && to === null) {
			// últimos N anos
			return Array.from(
				{ length: this.defaultYearsBack },
				(_, i) => currentYear - i
			);
		}
		const startYear = from ?? to ?? currentYear;
		const endYear = to ?? from ?? currentYear;
		const lo = Math.min(startYear, endYear);
		const hi = Math.max(startYear, endYear, lo);
		const years: number[] = [];
		for (let y = hi; y >= lo; y--) years.push(y);
		return years.length ? years : [currentYear];
	}

	private toYear(value?: string | Date): number | null {
		const ms = this.toEpochMs(value);
		if (ms === null) return null;
		return new Date(ms).getUTCFullYear();
	}

	private async safeLoadIpeRows(
		year: number
	): Promise<Record<string, string>[]> {
		try {
			return await this.loadIpeRows(year);
		} catch (error) {
			this.logger.warn(
				`Falha ao carregar IPE ${year}: ${error?.message || error}`
			);
			return [];
		}
	}

	private async loadIpeRows(year: number): Promise<Record<string, string>[]> {
		const fileName = `ipe_cia_aberta_${year}.zip`;
		const now = Date.now();
		const cached = this.textCache.get(fileName);
		if (cached && cached.expiresAt > now) return cached.rows;

		const inflight = this.inflight.get(fileName);
		if (inflight) return inflight;

		const request = (async () => {
			const url = `${this.baseUrl}/${fileName}`;
			const response = await firstValueFrom(
				this.httpService.get(url, {
					responseType: 'arraybuffer',
					timeout: 30000,
				})
			);
			const buffer = Buffer.from(response.data as ArrayBuffer);
			const csvText = await this.extractCsvFromZip(buffer, year);
			const parsed = Papa.parse<Record<string, string>>(csvText, {
				header: true,
				delimiter: ';',
				skipEmptyLines: true,
			});
			const rows = Array.isArray(parsed.data) ? parsed.data : [];
			this.textCache.set(fileName, {
				expiresAt: Date.now() + this.ttlMs,
				rows,
			});
			return rows;
		})();

		this.inflight.set(fileName, request);
		try {
			return await request;
		} finally {
			this.inflight.delete(fileName);
		}
	}

	/**
	 * Extrai o único CSV interno do zip IPE via yauzl. O zip de IPE contém
	 * `ipe_cia_aberta_AAAA.csv`; lê seus bytes em memória (cada CSV anual é
	 * ~10-50MB descomprimido — aceitável para descoberta eventual).
	 *
	 * `protected` (não `private`) para permitir que testes sobrescrevam o
	 * seam de unzip sem precisar sintetizar um zip real — basta uma subclasse
	 * de teste que retorna o CSV texte. A path de produção com yauzl fica
	 * coberta por type-check e smoke manual online. `year` é usado para aceitar
	 * apenas a entry esperada (`ipe_cia_aberta_${year}.csv`) e é repassado à
	 * subclasse de teste para despachar o CSV correto sem acoplar à URL.
	 */
	protected extractCsvFromZip(buffer: Buffer, year: number): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
				if (err || !zipfile) {
					reject(err || new Error('ipe_zip_open_failed'));
					return;
				}
				let resolved = false;
				const finish = (error: Error | null, text: string) => {
					if (resolved) return;
					resolved = true;
					zipfile.removeAllListeners();
					try {
						zipfile.close();
					} catch {
						// ignore
					}
					if (error) reject(error);
					else resolve(text);
				};

				zipfile.on('error', (e) => finish(e, ''));

				zipfile.readEntry();
				zipfile.on('entry', (entry) => {
					if (/\/$/.test(entry.fileName)) {
						zipfile.readEntry();
						return;
					}
					// Aceita apenas o CSV anual esperado; ignora metadados/outras
					// entries não relacionadas ao ano solicitado.
					if (entry.fileName !== `ipe_cia_aberta_${year}.csv`) {
						zipfile.readEntry();
						return;
					}
					zipfile.openReadStream(entry, (streamErr, stream) => {
						if (streamErr || !stream) {
							finish(streamErr || new Error('ipe_read_stream_failed'), '');
							return;
						}
						const chunks: Buffer[] = [];
						stream.on('data', (chunk: Buffer) => chunks.push(chunk));
						stream.on('error', (e) => finish(e, ''));
						stream.on('end', () => {
							finish(null, Buffer.concat(chunks).toString('utf8'));
						});
					});
				});
				zipfile.on('end', () => {
					// nenhuma entry de arquivo — resolve vazio para não travar.
					finish(null, '');
				});
			});
		});
	}

	private normalizeCnpj(cnpj?: string): string {
		return String(cnpj || '').replace(/[^\d]/g, '');
	}

	private parseDateMs(value?: string): number | null {
		const raw = String(value || '').trim();
		if (!raw) return null;
		// IPE usa datas ISO `YYYY-MM-DD` em Data_Entrega/Data_Referencia
		// (ex.: `2026-02-05`). `new Date` já interpreta corretamente.
		const parsed = new Date(raw).getTime();
		return Number.isFinite(parsed) ? parsed : null;
	}

	private parseDateIso(value?: string): string | null {
		const ms = this.parseDateMs(value);
		return ms === null ? null : new Date(ms).toISOString();
	}

	private toEpochMs(value?: string | Date): number | null {
		if (!value) return null;
		const parsed = value instanceof Date ? value : new Date(value);
		return Number.isFinite(parsed.getTime()) ? parsed.getTime() : null;
	}
}
