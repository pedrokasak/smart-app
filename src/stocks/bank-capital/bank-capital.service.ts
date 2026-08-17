import { Injectable, Logger } from '@nestjs/common';
import { getBankEntry } from './bank-map';
import { fetchQuarterValues } from './bcb-if-data.client';
import { BankCapitalResult } from './bank-capital.types';

const MAX_QUARTER_ATTEMPTS = 4;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// Mesma convencao do YahooFinanceAdapter (NEGATIVE_CACHE_TTL_MS = 3min): uma
// falha transitoria nao prova ausencia de dado, entao so segura a repeticao
// por alguns minutos em vez de congelar o simbolo em null por 24h.
const TRANSIENT_CACHE_TTL_MS = 3 * 60 * 1000;
// Teto de relogio para a caminhada inteira, alem do timeout de 8s por fetch.
// Sem ele, 4 tentativas sequenciais podem somar 32s no caminho critico do
// item — e o item so responde depois do BCB, mesmo com os fundamentos ja
// prontos. Lotes de FUNDAMENTALS_BATCH_SIZE=5 rodam sequencialmente, entao
// 32s por simbolo bancario se multiplicaria por lote. Com 10s, o pior caso da
// descoberta fica na mesma ordem de grandeza de um unico fetch estourado.
const DISCOVERY_BUDGET_MS = 10 * 1000;
const FETCH_TIMEOUT_MS = 8000;

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

interface DiscoveryOutcome {
	data: BankCapitalResult | null;
	/**
	 * `true` quando algum trimestre falhou por motivo transitorio (rede,
	 * timeout, HTTP de erro) ou quando o orcamento de tempo cortou a
	 * caminhada antes de esgotar as tentativas. Nesses casos o `null` nao
	 * significa "esse banco nao publica" e nao pode virar cache de 24h.
	 */
	transient: boolean;
}

@Injectable()
export class BankCapitalService {
	private readonly logger = new Logger(BankCapitalService.name);

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

		const outcome = await this.discover(entry);
		const transientMiss = outcome.transient && outcome.data === null;
		if (transientMiss) {
			this.logger.warn(
				`Falha transitoria ao consultar indicadores do BCB para ${entry.symbol}; cache curto de ${TRANSIENT_CACHE_TTL_MS}ms em vez de 24h`
			);
		}
		BankCapitalService.cache.set(entry.symbol, {
			expiresAt:
				Date.now() + (transientMiss ? TRANSIENT_CACHE_TTL_MS : CACHE_TTL_MS),
			data: outcome.data,
		});
		return outcome.data;
	}

	private async discover(entry: {
		symbol: string;
		bankName: string;
		prudentialCode: string;
	}): Promise<DiscoveryOutcome> {
		let anoMes = currentQuarterAnoMes(new Date());
		const startedAt = Date.now();
		let transient = false;

		for (let attempt = 0; attempt < MAX_QUARTER_ATTEMPTS; attempt++) {
			// Orcamento de relogio sobre a caminhada inteira: so comeca mais um
			// trimestre se ele ainda couber no teto no pior caso (timeout cheio).
			if (
				attempt > 0 &&
				Date.now() - startedAt + FETCH_TIMEOUT_MS > DISCOVERY_BUDGET_MS
			) {
				this.logger.warn(
					`Orcamento de ${DISCOVERY_BUDGET_MS}ms esgotado na descoberta do BCB para ${entry.symbol} apos ${attempt} trimestre(s); desistindo`
				);
				return { data: null, transient: true };
			}

			const values = await fetchQuarterValues(entry.prudentialCode, anoMes);
			if (!values.ok) transient = true;
			if (values.basileia !== null || values.imobilizacao !== null) {
				return {
					data: {
						symbol: entry.symbol,
						bankName: entry.bankName,
						period: anoMesToPeriod(anoMes),
						basileia: values.basileia,
						imobilizacao: values.imobilizacao,
					},
					transient: false,
				};
			}
			anoMes = previousQuarterAnoMes(anoMes);
		}

		return { data: null, transient };
	}
}
