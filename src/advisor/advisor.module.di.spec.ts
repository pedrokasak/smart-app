import { AppModule } from 'src/app.module';
import { AdvisorModule } from './advisor.module';
import {
	ADVISOR_ALLOCATION_TARGET_STORE,
	ADVISOR_BENCHMARK_SERIES,
	ADVISOR_CLIENT_PROFILE_STORE,
	ADVISOR_CONSENT_STORE,
	ADVISOR_INVITE_STORE,
	ADVISOR_MEMBERSHIP_STORE,
	ADVISOR_ORG_STORE,
	ADVISOR_PRICE_HISTORY,
	ADVISOR_RELATIONSHIP_STORE,
	ADVISOR_TRANSACTION_STORE,
} from './application/advisor.tokens';
import { AllocationTargetService } from './application/allocation-target.service';
import { ConsentService } from './application/consent.service';
import { CsvImportService } from './application/csv/csv-import.service';
import { PortfolioMetricsService } from './application/metrics/portfolio-metrics.service';
import { InviteService } from './application/invite.service';
import { ADVISOR_INVITE_NOTIFIER } from './application/ports/invite-notifier.port';
import { ADVISOR_INVITEE_IDENTITY } from './application/ports/invitee-identity.port';
import { ADVISOR_SHARED_PORTFOLIO_SOURCE } from './application/ports/shared-portfolio-source.port';
import { SharedPortfolioService } from './application/shared-portfolio.service';
import { TransactionService } from './application/transaction.service';
import { B2cSharedPortfolioSourceAdapter } from './infrastructure/b2c-shared-portfolio-source.adapter';
import { EmailInviteNotifierAdapter } from './infrastructure/email-invite-notifier.adapter';
import { UserInviteeIdentityAdapter } from './infrastructure/user-invitee-identity.adapter';
import { AdvisorAccessController } from './interface/advisor-access.controller';
import { PortfolioSharingReadModule } from 'src/portfolio/sharing/portfolio-sharing-read.module';
import { EmailModule } from 'src/notifications/email/email.module';
import { UsersModule } from 'src/users/users.module';
import { MacroBenchmarkSeriesAdapter } from './infrastructure/macro-benchmark-series.adapter';
import { MarketPriceHistoryAdapter } from './infrastructure/market-price-history.adapter';

/**
 * Sem subir um segundo grafo: `app.module.di.spec.ts` ja resolve o AppModule
 * inteiro (incluindo este modulo). Aqui so se trava a ligacao estatica.
 */
describe('AdvisorModule wiring', () => {
	it('is imported by AppModule', () => {
		const imports: unknown[] = Reflect.getMetadata('imports', AppModule);
		expect(imports).toContain(AdvisorModule);
	});

	it('provides the four store tokens', () => {
		const providers: Array<{ provide?: unknown }> = Reflect.getMetadata(
			'providers',
			AdvisorModule
		);
		const provided = providers.map((p) => p.provide);
		for (const token of [
			ADVISOR_ORG_STORE,
			ADVISOR_MEMBERSHIP_STORE,
			ADVISOR_RELATIONSHIP_STORE,
			ADVISOR_CLIENT_PROFILE_STORE,
		]) {
			expect(provided).toContain(token);
		}
	});

	it('provides and exports the portfolio services', () => {
		const providers: unknown[] = Reflect.getMetadata(
			'providers',
			AdvisorModule
		);
		const exported: unknown[] = Reflect.getMetadata('exports', AdvisorModule);
		for (const service of [
			TransactionService,
			CsvImportService,
			AllocationTargetService,
			PortfolioMetricsService,
		]) {
			expect(providers).toContain(service);
			expect(exported).toContain(service);
		}
	});

	it('binds the portfolio store and market tokens', () => {
		const providers: Array<{ provide?: unknown; useExisting?: unknown }> =
			Reflect.getMetadata('providers', AdvisorModule);
		const byToken = new Map(providers.map((p) => [p.provide, p]));
		expect(byToken.has(ADVISOR_TRANSACTION_STORE)).toBe(true);
		expect(byToken.has(ADVISOR_ALLOCATION_TARGET_STORE)).toBe(true);
		expect(byToken.get(ADVISOR_PRICE_HISTORY)).toMatchObject({
			useExisting: MarketPriceHistoryAdapter,
		});
		expect(byToken.get(ADVISOR_BENCHMARK_SERIES)).toMatchObject({
			useExisting: MacroBenchmarkSeriesAdapter,
		});
	});

	it('provides and exports the consent services', () => {
		const providers: unknown[] = Reflect.getMetadata(
			'providers',
			AdvisorModule
		);
		const exported: unknown[] = Reflect.getMetadata('exports', AdvisorModule);
		for (const service of [
			InviteService,
			ConsentService,
			SharedPortfolioService,
		]) {
			expect(providers).toContain(service);
			expect(exported).toContain(service);
		}
	});

	it('binds the consent stores and the B2C adapters', () => {
		const providers: Array<{ provide?: unknown; useExisting?: unknown }> =
			Reflect.getMetadata('providers', AdvisorModule);
		const byToken = new Map(providers.map((p) => [p.provide, p]));
		expect(byToken.has(ADVISOR_INVITE_STORE)).toBe(true);
		expect(byToken.has(ADVISOR_CONSENT_STORE)).toBe(true);
		expect(byToken.get(ADVISOR_INVITE_NOTIFIER)).toMatchObject({
			useExisting: EmailInviteNotifierAdapter,
		});
		expect(byToken.get(ADVISOR_INVITEE_IDENTITY)).toMatchObject({
			useExisting: UserInviteeIdentityAdapter,
		});
		expect(byToken.get(ADVISOR_SHARED_PORTFOLIO_SOURCE)).toMatchObject({
			useExisting: B2cSharedPortfolioSourceAdapter,
		});
	});

	it('imports the B2C read, e-mail and users modules', () => {
		const imports: unknown[] = Reflect.getMetadata('imports', AdvisorModule);
		for (const module of [
			PortfolioSharingReadModule,
			EmailModule,
			UsersModule,
		]) {
			expect(imports).toContain(module);
		}
	});

	it('registers the investor advisor-access controller', () => {
		const controllers: unknown[] = Reflect.getMetadata(
			'controllers',
			AdvisorModule
		);
		expect(controllers).toContain(AdvisorAccessController);
	});
});
