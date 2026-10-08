import { Inject, Injectable, Logger } from '@nestjs/common';
import {
	FUND_HOLDING_PRICE_WRITER,
	FundHoldingPriceWriter,
	INVESTMENT_FUND_SOURCE,
	INVESTMENT_FUND_STORE,
	InvestmentFundDataSource,
	InvestmentFundStore,
} from './ports/investment-funds.ports';

/** Nos primeiros dias do mês o arquivo novo ainda é curto (ou nem existe). */
const READ_PREVIOUS_MONTH_UNTIL_DAY = 10;

export interface QuotesRefreshResult {
	competence: string;
	status: 'parsed' | 'unchanged' | 'missing';
	rows?: number;
	invalidRows?: number;
	latestDate?: string | null;
	stored?: number;
}

/** `YYYYMM` das competências a ler, da mais antiga para a mais nova. */
export function competencesToRead(now: Date): string[] {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'America/Sao_Paulo',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(now);
	const pick = (type: string) =>
		Number(parts.find((part) => part.type === type)?.value);
	const year = pick('year');
	const month = pick('month');
	const day = pick('day');

	const current = `${year}${String(month).padStart(2, '0')}`;
	if (day > READ_PREVIOUS_MONTH_UNTIL_DAY) return [current];
	const previousYear = month === 1 ? year - 1 : year;
	const previousMonth = month === 1 ? 12 : month - 1;
	return [`${previousYear}${String(previousMonth).padStart(2, '0')}`, current];
}

/**
 * Leitura dos dados abertos de fundos da CVM (TRA-276): cadastro das classes
 * FIF e a última cota de cada uma.
 *
 * Idempotente: arquivo com o mesmo hash da última leitura não é processado de
 * novo, e o store nunca troca uma cota por outra mais antiga (a CVM republica
 * meses recentes com reapresentações). Fonte fora do ar não apaga nada — a
 * carteira segue com a última cota conhecida e a data dela.
 */
@Injectable()
export class InvestmentFundIngestionService {
	private readonly logger = new Logger(InvestmentFundIngestionService.name);
	private quotesInFlight: Promise<QuotesRefreshResult[]> | null = null;
	private registryInFlight: Promise<number | null> | null = null;

	constructor(
		@Inject(INVESTMENT_FUND_SOURCE)
		private readonly source: InvestmentFundDataSource,
		@Inject(INVESTMENT_FUND_STORE)
		private readonly store: InvestmentFundStore,
		@Inject(FUND_HOLDING_PRICE_WRITER)
		private readonly holdings: FundHoldingPriceWriter
	) {}

	/** Classes gravadas; `null` quando o arquivo não mudou ou não existe. */
	refreshRegistry(): Promise<number | null> {
		this.registryInFlight ??= this.doRefreshRegistry().finally(() => {
			this.registryInFlight = null;
		});
		return this.registryInFlight;
	}

	refreshQuotes(now: Date = new Date()): Promise<QuotesRefreshResult[]> {
		this.quotesInFlight ??= this.doRefreshQuotes(now).finally(() => {
			this.quotesInFlight = null;
		});
		return this.quotesInFlight;
	}

	private async doRefreshRegistry(): Promise<number | null> {
		const key = 'registry';
		const previous = await this.store.findIngestion(key);
		const read = await this.source.fetchRegistry(previous?.sha256);
		if (read.status !== 'parsed') return null;
		if (read.data.length === 0) {
			// Arquivo sem nenhuma classe FIF é arquivo quebrado, não "zero fundos".
			throw new Error('Registro da CVM sem nenhuma classe FIF');
		}

		const stored = await this.store.replaceClasses(read.data);
		await this.store.saveIngestion({
			key,
			sourceUrl: read.sourceUrl,
			sha256: read.sha256,
			rows: read.data.length,
			latestDate: null,
			ingestedAt: new Date(),
		});
		return stored;
	}

	private async doRefreshQuotes(now: Date): Promise<QuotesRefreshResult[]> {
		const results: QuotesRefreshResult[] = [];
		for (const competence of competencesToRead(now)) {
			const key = `daily:${competence}`;
			const previous = await this.store.findIngestion(key);
			const read = await this.source.fetchDailyReport(
				competence,
				previous?.sha256
			);
			if (read.status !== 'parsed') {
				results.push({ competence, status: read.status });
				continue;
			}

			const { quotes, rows, invalidRows, latestDate } = read.data;
			const stored = await this.store.upsertLatestQuotes(
				quotes,
				read.sourceUrl
			);
			await this.store.saveIngestion({
				key,
				sourceUrl: read.sourceUrl,
				sha256: read.sha256,
				rows,
				latestDate,
				ingestedAt: new Date(),
			});
			if (invalidRows > 0) {
				this.logger.warn(
					`Informe Diário ${competence}: ${invalidRows} de ${rows} linha(s) ignorada(s) por formato inválido`
				);
			}
			results.push({
				competence,
				status: 'parsed',
				rows,
				invalidRows,
				latestDate,
				stored,
			});
		}

		if (results.some((result) => result.status === 'parsed')) {
			await this.syncHoldings();
		}
		return results;
	}

	/** Cota nova vai para as posições, para quem lê `currentPrice` direto. */
	private async syncHoldings(): Promise<void> {
		try {
			const cnpjs = await this.holdings.heldCnpjs();
			if (cnpjs.length === 0) return;
			const held = await this.holdings.applyQuotes(
				await this.store.findClassQuotes(cnpjs)
			);
			this.logger.log(`Cota de fundo gravada em ${held} posição(ões)`);
		} catch (error) {
			this.logger.error(
				`Gravação da cota nas posições falhou: ${(error as Error)?.message || error}`
			);
		}
	}
}
