import { HttpService } from '@nestjs/axios';
import {
	MacroSeriesService,
	todayInSaoPaulo,
} from 'src/macro-indicators/application/macro-series.service';
import type {
	MacroSeriesPoint,
	MacroSeriesRepository,
} from 'src/macro-indicators/application/macro-series.ports';
import {
	MACRO_SERIES_KEYS,
	SERIES_CATALOG,
} from 'src/macro-indicators/domain/series-catalog';
import { BcbSgsSource } from 'src/macro-indicators/infrastructure/bcb-sgs.source';
import { FixedIncomeComparisonService } from './application/fixed-income-comparison.service';
import { FixedIncomeRatesService } from './application/fixed-income-rates.service';
import { FixedIncomeVerdictService } from './application/fixed-income-verdict.service';
import type {
	StoredTesouroOffers,
	TesouroOffersSnapshot,
	TesouroOffersStore,
} from './application/ports/tesouro-offers.ports';
import { TesouroOffersService } from './application/tesouro-offers.service';
import { addDays, daysBetween } from './domain/dates';
import { TesouroTransparenteCsvSource } from './infrastructure/tesouro-transparente-csv.source';
import { TrackerrIaVerdictNarratorAdapter } from './infrastructure/trackerr-ia-verdict-narrator.adapter';
import { buildVerdictFacts } from './application/verdict-facts';
import { validateVerdictText } from './application/verdict-validator';

/**
 * Teste AO VIVO contra as fontes oficiais — Tesouro Transparente e BACEN SGS.
 * Fica desligado no CI (depende de rede e de dado que muda todo dia); roda com:
 *
 *   RUN_LIVE_TESTS=1 npx jest src/fixed-income/fixed-income.live.spec.ts
 *
 * O bloco do veredito por IA também exige um trackerr-ia no ar (com as chaves
 * de LLM) e o mesmo segredo de serviço nos dois lados:
 *
 *   RUN_LIVE_IA=1 TRAKKER_IA_URL=http://127.0.0.1:8000  *   TRACKERR_IA_SERVICE_TOKEN=... npx jest src/fixed-income/fixed-income.live.spec.ts
 *
 * Existe para responder uma pergunta que teste com dado falso não responde: o
 * que está sendo lido hoje é mesmo taxa de Tesouro Direto e CDI/IPCA reais?
 */
const live = process.env.RUN_LIVE_TESTS === '1' ? describe : describe.skip;
const liveIa =
	process.env.RUN_LIVE_IA === '1' && process.env.TRAKKER_IA_URL
		? describe
		: describe.skip;

class InMemoryMacroRepository implements MacroSeriesRepository {
	private readonly data = new Map<number, Map<string, number>>();
	private readonly fetched = new Map<number, Date>();

	async findRange(
		code: number,
		from: string,
		to: string
	): Promise<MacroSeriesPoint[]> {
		return [...(this.data.get(code) ?? new Map()).entries()]
			.filter(([date]) => date >= from && date <= to)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([date, value]) => ({ date, value }));
	}

	async lastPoint(code: number) {
		const dates = [...(this.data.get(code)?.keys() ?? [])].sort();
		const date = dates.at(-1);
		return date ? { date, fetchedAt: this.fetched.get(code) as Date } : null;
	}

	async upsertMany(code: number, points: MacroSeriesPoint[], fetchedAt: Date) {
		const series = this.data.get(code) ?? new Map<string, number>();
		for (const point of points) series.set(point.date, point.value);
		this.data.set(code, series);
		this.fetched.set(code, fetchedAt);
		return points.length;
	}
}

class MemoryTesouroStore implements TesouroOffersStore {
	private saved: StoredTesouroOffers | null = null;
	async load() {
		return this.saved;
	}
	async save(snapshot: TesouroOffersSnapshot, fetchedAt: Date) {
		this.saved = { ...snapshot, fetchedAt };
	}
}

const today = () => new Date().toISOString().slice(0, 10);

/** Janela que o job diário de produção mantém no banco para cada série. */
const SEED_WINDOW_DAYS = { CDI: 30, SELIC_META: 120, IPCA: 450 } as const;

/**
 * Taxas e títulos lidos de verdade; só o banco é trocado por memória. O
 * repositório já nasce com a janela recente — o mesmo estado que o job diário
 * deixa no Mongo —, para o teste não refazer o backfill de 2000 até hoje, que
 * o SGS responde devagar e às vezes estoura o tempo.
 */
/** O SGS responde 502 de vez em quando; uma tentativa a mais evita falso alarme. */
async function withRetry<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
	for (let attempt = 1; ; attempt += 1) {
		try {
			return await run();
		} catch (error) {
			if (attempt >= attempts) throw error;
			await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
		}
	}
}

async function realRatesService() {
	const repository = new InMemoryMacroRepository();
	const source = new BcbSgsSource();
	const end = todayInSaoPaulo(new Date());
	for (const key of MACRO_SERIES_KEYS) {
		const descriptor = SERIES_CATALOG[key];
		const points = await withRetry(() =>
			source.fetch(descriptor, addDays(end, -SEED_WINDOW_DAYS[key]), end)
		);
		await repository.upsertMany(descriptor.code, points, new Date());
	}
	const macro = new MacroSeriesService(repository, source);
	const tesouro = new TesouroOffersService(
		new TesouroTransparenteCsvSource(),
		new MemoryTesouroStore()
	);
	return new FixedIncomeRatesService(macro, tesouro);
}

const REAL_REQUEST = {
	principal: 10_000,
	years: 3,
	offers: [
		{ kind: 'CDB' as const, indexer: 'PERCENT_CDI' as const, ratePct: 110 },
		{ kind: 'LCI' as const, indexer: 'PERCENT_CDI' as const, ratePct: 95 },
	],
};
const pct = (value: number) => value.toFixed(2).replace('.', ',');

live('fontes reais: Tesouro Transparente + BACEN', () => {
	jest.setTimeout(300_000);

	it('Tesouro Direto: lê títulos dos três tipos com taxa plausível e pregão recente', async () => {
		const snapshot = await new TesouroTransparenteCsvSource().fetchLatest();

		const families = new Set(snapshot.titles.map((title) => title.family));
		expect([...families].sort()).toEqual(['IPCA_PLUS', 'PREFIXED', 'SELIC']);
		expect(snapshot.titles.length).toBeGreaterThanOrEqual(6);
		expect(new Set(snapshot.titles.map((title) => title.id)).size).toBe(
			snapshot.titles.length
		);

		// Pregão de, no máximo, 10 dias atrás (fim de semana + feriado prolongado).
		expect(daysBetween(snapshot.baseDate, today())).toBeLessThanOrEqual(10);
		expect(
			snapshot.titles.every((title) => title.baseDate === snapshot.baseDate)
		).toBe(true);

		for (const title of snapshot.titles) {
			expect(title.maturityDate > snapshot.baseDate).toBe(true);
			expect(title.unitPrice).toBeGreaterThan(0);
			if (title.family === 'SELIC') expect(title.buyRatePct).toBeLessThan(2); // spread
			if (title.family === 'PREFIXED')
				expect(title.buyRatePct).toBeGreaterThan(3);
			if (title.family === 'IPCA_PLUS') {
				expect(title.buyRatePct).toBeGreaterThan(0);
				expect(title.buyRatePct).toBeLessThan(15);
			}
		}

		console.log(
			`\nTesouro Direto — pregão de ${snapshot.baseDate} (${snapshot.sourceUrl})\n` +
				snapshot.titles
					.sort((a, b) => a.name.localeCompare(b.name))
					.map(
						(title) =>
							`  ${title.name.padEnd(24)} venc ${title.maturityDate}  taxa compra ${pct(title.buyRatePct).padStart(6)}  PU R$ ${pct(title.unitPrice)}`
					)
					.join('\n')
		);
	});

	it('comparação de ponta a ponta só com dado real (CDI, IPCA 12m e Tesouro) + ofertas digitadas', async () => {
		const ratesService = await realRatesService();
		const rates = await ratesService.getRates();
		expect(rates.cdi?.valuePct).toBeGreaterThan(1);
		expect(rates.cdi?.valuePct).toBeLessThan(40);
		expect(rates.selicMeta?.valuePct).toBeGreaterThan(1);
		expect(rates.ipca12m?.valuePct).toBeGreaterThan(-2);
		expect(rates.ipca12m?.valuePct).toBeLessThan(30);
		expect(rates.tesouro?.titles.length).toBeGreaterThan(5);
		expect(rates.cdi?.stale).toBe(false);

		const result = await new FixedIncomeComparisonService(ratesService).compare(
			REAL_REQUEST
		);

		expect(
			result.rows.filter((row) => row.family === 'TESOURO').length
		).toBeGreaterThanOrEqual(2);
		expect(result.rows.filter((row) => row.isBest)).toHaveLength(1);
		expect(result.scenario.cdi.source).toBe('market');
		expect(result.scenario.ipca.source).toBe('market');

		console.log(
			`\nCDI ${pct(rates.cdi!.valuePct)}% a.a. (${rates.cdi!.asOf}, ${rates.cdi!.source}) | ` +
				`Selic meta ${pct(rates.selicMeta!.valuePct)}% (${rates.selicMeta!.asOf}) | ` +
				`IPCA 12m ${pct(rates.ipca12m!.valuePct)}% (ref. ${rates.ipca12m!.asOf.slice(0, 7)}, ${rates.ipca12m!.source})\n` +
				`Simulação R$ 10.000 por 3 anos (IR ${pct(result.scenario.irRatePct)}%):\n` +
				result.rows
					.map(
						(row) =>
							`  ${row.isBest ? '★' : ' '} ${row.name.padEnd(26)} bruto ${pct(row.grossAnnualPct).padStart(6)}  líq ${pct(row.netAnnualPct).padStart(6)}  real ${pct(row.realAnnualPct).padStart(6)}  final R$ ${pct(row.netFinal)}`
					)
					.join('\n') +
				`\n${result.analysis.headline}\n` +
				result.analysis.points.map((point) => `  - ${point.text}`).join('\n') +
				(result.warnings.length
					? `\nAvisos: ${result.warnings.join(' | ')}`
					: '')
		);
	});
});

liveIa(
	'veredito por IA de verdade: trackerr-ia + LLM + validação do server',
	() => {
		jest.setTimeout(180_000);

		it('escreve sobre os números reais e o texto passa na validação', async () => {
			const comparison = new FixedIncomeComparisonService(
				await realRatesService()
			);
			const adapter = new TrackerrIaVerdictNarratorAdapter(new HttpService());

			const result = await comparison.compare(REAL_REQUEST);
			const facts = buildVerdictFacts(result);

			const raw = await adapter.narrate(facts);
			const validation = validateVerdictText(raw, facts);
			console.log(
				`
Texto cru da IA:
  ${raw}
Validação: ${JSON.stringify(validation)}`
			);
			expect(raw).not.toBeNull();
			expect(validation).toEqual({ valid: true });

			const verdict = await new FixedIncomeVerdictService(
				comparison,
				adapter
			).verdict(REAL_REQUEST);
			console.log(`
Veredito servido (${verdict.source}):
  ${verdict.text}`);
			expect(verdict.source).toBe('ai');
		});
	}
);
