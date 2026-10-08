import { competencesToRead } from './application/investment-fund-ingestion.service';
import type {
	DailyReport,
	SourceRead,
} from './application/ports/investment-funds.ports';
import type { InvestmentFundClass } from './domain/fund-class';
import { CvmInvestmentFundSource } from './infrastructure/cvm-investment-fund.source';

/**
 * Teste AO VIVO contra os dados abertos da CVM (TRA-276). Fica desligado no
 * CI (depende de rede e de dado que muda todo dia); roda com:
 *
 *   RUN_LIVE_TESTS=1 npx jest src/investment-funds/investment-funds.live.spec.ts
 *
 * Responde o que teste com dado falso não responde: o arquivo que a CVM
 * publica hoje ainda tem o formato que o parser espera, e as cotas lidas
 * pertencem a classes do cadastro?
 */
const live = process.env.RUN_LIVE_TESTS === '1' ? describe : describe.skip;

const DAY_MS = 24 * 60 * 60 * 1000;

live('CVM ao vivo (TRA-276)', () => {
	jest.setTimeout(240_000);
	const source = new CvmInvestmentFundSource();
	let registry: InvestmentFundClass[] = [];
	let daily: DailyReport | null = null;

	beforeAll(async () => {
		const reg = await source.fetchRegistry();
		if (reg.status !== 'parsed') throw new Error(`registro ${reg.status}`);
		registry = reg.data;

		// Mais nova primeiro: no começo do mês o arquivo corrente pode faltar.
		for (const competence of competencesToRead(new Date()).reverse()) {
			const read: SourceRead<DailyReport> =
				await source.fetchDailyReport(competence);
			if (read.status === 'parsed') {
				daily = read.data;
				break;
			}
		}
	});

	it('reads tens of thousands of FIF classes from the registry', () => {
		expect(registry.length).toBeGreaterThan(15_000);
		const multimercado = registry.filter(
			(item) => item.classification === 'Multimercado'
		);
		expect(multimercado.length).toBeGreaterThan(1_000);
		expect(registry.every((item) => /^\d{14}$/.test(item.cnpj))).toBe(true);
	});

	it('reads the latest quote of each class from the Informe Diário', () => {
		expect(daily).not.toBeNull();
		const report = daily as DailyReport;
		expect(report.quotes.length).toBeGreaterThan(15_000);
		expect(report.invalidRows / report.rows).toBeLessThan(0.01);

		// Publicado com atraso de poucos dias úteis, nunca no futuro.
		const latest = new Date(`${report.latestDate}T12:00:00Z`).getTime();
		expect(Date.now() - latest).toBeLessThan(15 * DAY_MS);
		expect(latest).toBeLessThanOrEqual(Date.now());

		const positive = report.quotes.filter((quote) => quote.quota > 0);
		expect(positive.length / report.quotes.length).toBeGreaterThan(0.9);
	});

	it('matches quotes to registry classes', () => {
		const report = daily as DailyReport;
		const known = new Set(registry.map((item) => item.cnpj));
		const classQuotes = report.quotes.filter((quote) => !quote.subclassId);
		const matched = classQuotes.filter((quote) => known.has(quote.cnpj));

		expect(matched.length / classQuotes.length).toBeGreaterThan(0.9);
	});
});
