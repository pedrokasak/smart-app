import { Injectable } from '@nestjs/common';
import { getBankEntry } from './bank-map';
import { fetchQuarterValues } from './bcb-if-data.client';
import { BankCapitalResult } from './bank-capital.types';

const MAX_QUARTER_ATTEMPTS = 4;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function currentQuarterAnoMes(now: Date): string {
	const year = now.getUTCFullYear();
	const month = now.getUTCMonth() + 1; // 1-12
	const closedMonth =
		month >= 12 ? 12 : month >= 9 ? 9 : month >= 6 ? 6 : month >= 3 ? 3 : 12;
	const closedYear = month >= 3 ? year : year - 1;
	return `${closedYear}${String(closedMonth).padStart(2, '0')}`;
}

function previousQuarterAnoMes(anoMes: string): string {
	const year = Number(anoMes.slice(0, 4));
	const month = Number(anoMes.slice(4, 6));
	if (month === 3) return `${year - 1}12`;
	return `${year}${String(month - 3).padStart(2, '0')}`;
}

function anoMesToPeriod(anoMes: string): string {
	return `${anoMes.slice(0, 4)}-${anoMes.slice(4, 6)}`;
}

@Injectable()
export class BankCapitalService {
	private static readonly cache = new Map<
		string,
		{ expiresAt: number; data: BankCapitalResult | null }
	>();

	async getIndicators(symbol: string): Promise<BankCapitalResult | null> {
		const entry = getBankEntry(symbol);
		if (!entry) return null;

		const now = Date.now();
		const cached = BankCapitalService.cache.get(entry.symbol);
		if (cached && cached.expiresAt > now) return cached.data;

		const result = await this.discover(entry);
		BankCapitalService.cache.set(entry.symbol, {
			expiresAt: now + CACHE_TTL_MS,
			data: result,
		});
		return result;
	}

	private async discover(entry: {
		symbol: string;
		bankName: string;
		prudentialCode: string;
	}): Promise<BankCapitalResult | null> {
		let anoMes = currentQuarterAnoMes(new Date());

		for (let attempt = 0; attempt < MAX_QUARTER_ATTEMPTS; attempt++) {
			const values = await fetchQuarterValues(entry.prudentialCode, anoMes);
			if (values.basileia !== null || values.imobilizacao !== null) {
				return {
					symbol: entry.symbol,
					bankName: entry.bankName,
					period: anoMesToPeriod(anoMes),
					basileia: values.basileia,
					imobilizacao: values.imobilizacao,
				};
			}
			anoMes = previousQuarterAnoMes(anoMes);
		}

		return null;
	}
}
