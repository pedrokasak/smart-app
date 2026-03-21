import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import Papa from 'papaparse';

export interface CvmComputedIndicators {
	referenceYear: number;
	revenue: number;
	netIncome: number;
	totalAssets: number;
	shareholdersEquity: number;
	roe: number;
	netMargin: number;
}

@Injectable()
export class CvmOpenDataAdapter {
	private readonly logger = new Logger(CvmOpenDataAdapter.name);
	private readonly baseUrl =
		'https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS';
	private readonly textCache = new Map<
		string,
		{ expiresAt: number; rows: Record<string, string>[] }
	>();
	private readonly inflight = new Map<string, Promise<Record<string, string>[]>>();
	private readonly ttlMs = 6 * 60 * 60 * 1000;

	constructor(private readonly httpService: HttpService) {}

	private normalizeCnpj(cnpj?: string): string {
		return String(cnpj || '').replace(/[^\d]/g, '');
	}

	private toNumber(value: unknown): number {
		const raw = String(value ?? '').trim();
		if (!raw) return 0;
		const normalized = raw.replace(/\./g, '').replace(',', '.');
		const parsed = Number(normalized);
		return Number.isFinite(parsed) ? parsed : 0;
	}

	private async loadCsvRows(fileName: string): Promise<Record<string, string>[]> {
		const now = Date.now();
		const cached = this.textCache.get(fileName);
		if (cached && cached.expiresAt > now) {
			return cached.rows;
		}
		const inflight = this.inflight.get(fileName);
		if (inflight) return inflight;

		const request = (async () => {
			const url = `${this.baseUrl}/${fileName}`;
			const response = await firstValueFrom(
				this.httpService.get(url, { responseType: 'text', timeout: 30000 })
			);
			const csvText = String(response.data || '');
			const parsed = Papa.parse<Record<string, string>>(csvText, {
				header: true,
				delimiter: ';',
				skipEmptyLines: true,
			});
			const rows = Array.isArray(parsed.data) ? parsed.data : [];
			this.textCache.set(fileName, { expiresAt: Date.now() + this.ttlMs, rows });
			return rows;
		})();

		this.inflight.set(fileName, request);
		try {
			return await request;
		} finally {
			this.inflight.delete(fileName);
		}
	}

	private pickLatestRefDate(rows: Record<string, string>[]): string {
		const dates = rows
			.map((r) => String(r.DT_REFER || '').trim())
			.filter((v) => v.length >= 10)
			.sort();
		return dates.length ? dates[dates.length - 1] : '';
	}

	private sumByPrefix(
		rows: Record<string, string>[],
		prefixes: string[],
		refDate?: string
	): number {
		const filtered = refDate
			? rows.filter((r) => String(r.DT_REFER || '').startsWith(refDate))
			: rows;
		let sum = 0;
		for (const prefix of prefixes) {
			const exactRows = filtered.filter(
				(r) => String(r.CD_CONTA || '').trim() === prefix
			);
			if (exactRows.length > 0) {
				sum += exactRows.reduce((acc, row) => acc + this.toNumber(row.VL_CONTA), 0);
				continue;
			}

			// fallback only when parent account is missing
			const childRows = filtered.filter((r) =>
				String(r.CD_CONTA || '').trim().startsWith(`${prefix}.`)
			);
			sum += childRows.reduce((acc, row) => acc + this.toNumber(row.VL_CONTA), 0);
		}
		return sum;
	}

	async getComputedIndicatorsByCnpj(
		cnpj: string,
		year: number
	): Promise<CvmComputedIndicators | null> {
		const normalizedCnpj = this.normalizeCnpj(cnpj);
		if (!normalizedCnpj) return null;

		const dreFile = `dfp_cia_aberta_DRE_con_${year}.csv`;
		const bpaFile = `dfp_cia_aberta_BPA_con_${year}.csv`;
		const bppFile = `dfp_cia_aberta_BPP_con_${year}.csv`;

		try {
			const [dreRowsRaw, bpaRowsRaw, bppRowsRaw] = await Promise.all([
				this.loadCsvRows(dreFile),
				this.loadCsvRows(bpaFile),
				this.loadCsvRows(bppFile),
			]);

			const filterByCnpj = (rows: Record<string, string>[]) =>
				rows.filter((r) => this.normalizeCnpj(r.CNPJ_CIA) === normalizedCnpj);

			const dreRows = filterByCnpj(dreRowsRaw);
			const bpaRows = filterByCnpj(bpaRowsRaw);
			const bppRows = filterByCnpj(bppRowsRaw);

			if (!dreRows.length && !bpaRows.length && !bppRows.length) return null;

			const refDate =
				this.pickLatestRefDate(dreRows) ||
				this.pickLatestRefDate(bpaRows) ||
				this.pickLatestRefDate(bppRows);

			const revenue = this.sumByPrefix(dreRows, ['3.01'], refDate);
			const netIncome = this.sumByPrefix(dreRows, ['3.11'], refDate);
			const totalAssets = this.sumByPrefix(bpaRows, ['1'], refDate);
			const shareholdersEquity = this.sumByPrefix(bppRows, ['2.03'], refDate);

			const roe =
				shareholdersEquity > 0 ? netIncome / shareholdersEquity : 0;
			const netMargin = revenue > 0 ? netIncome / revenue : 0;

			return {
				referenceYear: year,
				revenue,
				netIncome,
				totalAssets,
				shareholdersEquity,
				roe,
				netMargin,
			};
		} catch (error) {
			this.logger.warn(
				`Falha ao consultar CVM para CNPJ ${normalizedCnpj}: ${error?.message || error}`
			);
			return null;
		}
	}
}
