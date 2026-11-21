import { Logger } from '@nestjs/common';
import {
	ClientActionForbiddenError,
	ClientNotAccessibleError,
} from 'src/advisor/application/access-errors';
import type { AccessContext } from 'src/advisor/application/authorization.service';
import type { ClientSummary } from 'src/advisor/application/client-directory.service';
import type { ClientPortfolioMetrics } from 'src/advisor/application/metrics/build-portfolio-metrics';
import { PortfolioMetricsService } from 'src/advisor/application/metrics/portfolio-metrics.service';
import {
	NoActiveConsentError,
	SharedPortfolioService,
} from 'src/advisor/application/shared-portfolio.service';
import { TransactionService } from 'src/advisor/application/transaction.service';
import {
	OrgRole,
	PortfolioProvenance,
	ProfileOrigin,
	RelationshipStatus,
} from 'src/advisor/domain/enums';
import { WealthSummaryAssembler } from './wealth-summary.assembler';

const ctx = {
	orgId: 'org-1',
	userId: 'u1',
	role: OrgRole.OrgAdmin,
} as never as AccessContext;

const client = (origin: ProfileOrigin): ClientSummary => ({
	id: 'client-1',
	name: 'Maria Segredo',
	origin,
	relationshipStatus: RelationshipStatus.Active,
	hasSharedPortfolios: false,
});

const metricsOf = (
	totalValueMinor: number,
	provenance: PortfolioProvenance | null,
	asOf = '2026-11-20'
) => ({ asOf, totalValueMinor, provenance }) as ClientPortfolioMetrics;

const sharedOf = (...metrics: ClientPortfolioMetrics[]) =>
	metrics.map((m, i) => ({
		portfolioId: `p${i}`,
		name: `P${i}`,
		metrics: m,
		unreconciledSymbols: [],
	}));

describe('WealthSummaryAssembler', () => {
	const listTransactions = jest.fn();
	const getMetrics = jest.fn();
	const getSharedMetrics = jest.fn();
	let assembler: WealthSummaryAssembler;
	let warn: jest.SpyInstance;

	beforeEach(() => {
		listTransactions.mockReset().mockResolvedValue([]);
		getMetrics.mockReset();
		getSharedMetrics.mockReset().mockRejectedValue(new NoActiveConsentError());
		warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
		assembler = new WealthSummaryAssembler(
			{ listTransactions } as unknown as TransactionService,
			{ getMetrics } as unknown as PortfolioMetricsService,
			{ getSharedMetrics } as unknown as SharedPortfolioService
		);
	});

	afterEach(() => jest.restoreAllMocks());

	it('builds only the ledger part for an advisor-created client with transactions', async () => {
		listTransactions.mockResolvedValue([{ id: 't1' }]);
		getMetrics.mockResolvedValue(
			metricsOf(150_000, PortfolioProvenance.Manual)
		);

		const wealth = await assembler.build(
			ctx,
			client(ProfileOrigin.AdvisorCreated)
		);

		expect(wealth).toEqual({
			currency: 'BRL',
			asOf: '2026-11-20',
			totalMinor: 150_000,
			totalIsPartial: false,
			parts: [
				{
					source: 'ADVISOR_LEDGER',
					provenance: PortfolioProvenance.Manual,
					valueMinor: 150_000,
				},
			],
		});
	});

	it('sums the shared portfolios into one part with the weakest seal', async () => {
		getSharedMetrics.mockResolvedValue(
			sharedOf(
				metricsOf(100_000, PortfolioProvenance.Verified),
				metricsOf(40_050, PortfolioProvenance.Partial)
			)
		);

		const wealth = await assembler.build(
			ctx,
			client(ProfileOrigin.ClientCreated)
		);

		expect(listTransactions).not.toHaveBeenCalled();
		expect(wealth.parts).toEqual([
			{
				source: 'B2C_SHARED',
				provenance: PortfolioProvenance.Partial,
				valueMinor: 140_050,
			},
		]);
		expect(wealth.totalMinor).toBe(140_050);
		expect(wealth.totalIsPartial).toBe(false);
	});

	it('counts a null seal as MANUAL when picking the weakest', async () => {
		getSharedMetrics.mockResolvedValue(
			sharedOf(metricsOf(1, PortfolioProvenance.Verified), metricsOf(1, null))
		);
		const wealth = await assembler.build(
			ctx,
			client(ProfileOrigin.ClientCreated)
		);
		expect(wealth.parts[0].provenance).toBe(PortfolioProvenance.Manual);
	});

	it('keeps both parts side by side and sums the total (test data only)', async () => {
		listTransactions.mockResolvedValue([{ id: 't1' }]);
		getMetrics.mockResolvedValue(metricsOf(10_000, PortfolioProvenance.Manual));
		getSharedMetrics.mockResolvedValue(
			sharedOf(metricsOf(25_000, PortfolioProvenance.Verified))
		);

		const wealth = await assembler.build(
			ctx,
			client(ProfileOrigin.AdvisorCreated)
		);

		expect(wealth.parts.map((p) => [p.source, p.valueMinor])).toEqual([
			['ADVISOR_LEDGER', 10_000],
			['B2C_SHARED', 25_000],
		]);
		expect(wealth.totalMinor).toBe(35_000);
		expect(wealth.totalIsPartial).toBe(false);
	});

	it('flags a partial total when the ledger metrics fail but keeps the other part', async () => {
		listTransactions.mockResolvedValue([{ id: 't1' }]);
		getMetrics.mockRejectedValue(new Error('boom with Maria Segredo data'));
		getSharedMetrics.mockResolvedValue(
			sharedOf(metricsOf(25_000, PortfolioProvenance.Verified))
		);

		const wealth = await assembler.build(
			ctx,
			client(ProfileOrigin.AdvisorCreated)
		);

		expect(wealth.parts).toEqual([
			{
				source: 'ADVISOR_LEDGER',
				provenance: null,
				valueMinor: null,
				unavailableReason: 'METRICS_UNAVAILABLE',
			},
			{
				source: 'B2C_SHARED',
				provenance: PortfolioProvenance.Verified,
				valueMinor: 25_000,
			},
		]);
		expect(wealth.totalMinor).toBe(25_000);
		expect(wealth.totalIsPartial).toBe(true);
		const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
		expect(logged).toContain('client-1');
		expect(logged).toContain('Error');
		expect(logged).not.toContain('Maria Segredo');
	});

	it('has a null total when the only part is unavailable', async () => {
		getSharedMetrics.mockRejectedValue(new Error('down'));
		const wealth = await assembler.build(
			ctx,
			client(ProfileOrigin.ClientCreated)
		);
		expect(wealth.totalMinor).toBeNull();
		expect(wealth.totalIsPartial).toBe(true);
		expect(wealth.parts).toHaveLength(1);
	});

	it('returns no parts and a zero total when there is nothing to show', async () => {
		const wealth = await assembler.build(
			ctx,
			client(ProfileOrigin.AdvisorCreated)
		);
		expect(getMetrics).not.toHaveBeenCalled();
		expect(wealth).toEqual({
			currency: 'BRL',
			asOf: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
			totalMinor: 0,
			totalIsPartial: false,
			parts: [],
		});
	});

	it('omits the shared part when consent exists but no portfolio came back', async () => {
		getSharedMetrics.mockResolvedValue([]);
		const wealth = await assembler.build(
			ctx,
			client(ProfileOrigin.ClientCreated)
		);
		expect(wealth.parts).toEqual([]);
	});

	it.each([
		['ClientNotAccessibleError', () => new ClientNotAccessibleError()],
		['ClientActionForbiddenError', () => new ClientActionForbiddenError()],
	])('propagates %s from the ledger source', async (_name, make) => {
		listTransactions.mockRejectedValue(make());
		await expect(
			assembler.build(ctx, client(ProfileOrigin.AdvisorCreated))
		).rejects.toBeInstanceOf(make().constructor);
	});

	it('propagates ClientNotAccessibleError from the shared source', async () => {
		getSharedMetrics.mockRejectedValue(new ClientNotAccessibleError());
		await expect(
			assembler.build(ctx, client(ProfileOrigin.ClientCreated))
		).rejects.toBeInstanceOf(ClientNotAccessibleError);
	});
});
