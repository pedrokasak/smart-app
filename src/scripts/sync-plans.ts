/**
 * CLI de reconciliação de planos (TRA-18).
 *
 * Uso:
 *   bun tsx src/scripts/sync-plans.ts            # aplica alterações
 *   bun tsx src/scripts/sync-plans.ts --dry-run  # só simula e imprime o diff
 *
 * Requer DATABASE_URL e (para bind ao Stripe) as variáveis
 * STRIPE_PLAN_<SLUG>_PRODUCT_ID / _PRICE_MONTHLY_ID / _PRICE_ANNUAL_ID
 * conforme `canonical-plans.config.ts`.
 *
 * O script bootstrapa o AppModule em modo standalone (sem listen) para
 * reaproveitar toda a wiring de Mongoose já existente — o mesmo container
 * usado em runtime é o que roda o seed. Rodar duas vezes seguidas é
 * seguro: o serviço é idempotente por construção.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from 'src/app.module';
import { PlanSyncService } from 'src/subscription/plan-sync/plan-sync.service';

async function main() {
	const dryRun = process.argv.includes('--dry-run');
	const logger = new Logger('sync-plans');

	const app = await NestFactory.createApplicationContext(AppModule, {
		logger: ['log', 'warn', 'error'],
	});
	try {
		const service = app.get(PlanSyncService);
		const report = await service.syncCanonicalPlans({ dryRun });

		logger.log(
			`sync concluído (dryRun=${report.dryRun}). ${report.plans.length} planos canônicos, ${report.legacy.length} legados.`
		);

		for (const entry of report.plans) {
			logger.log(
				`[${entry.slug}] ${entry.action} (match=${entry.matchedBy})${
					entry.planId ? ` id=${entry.planId}` : ''
				}`
			);
			for (const change of entry.changes) {
				logger.log(
					`  · ${change.field}: ${JSON.stringify(change.from)} → ${JSON.stringify(change.to)}`
				);
			}
			for (const warning of entry.warnings) logger.warn(`  · ${warning}`);
			for (const todo of entry.todos) logger.warn(`  · TODO ${todo}`);
		}
		for (const legacy of report.legacy) {
			logger.log(
				`[legacy] ${legacy.name} (${legacy.planId}) → ${legacy.action}: ${legacy.reason}`
			);
		}
		if (report.todos.length) {
			logger.warn(
				`${report.todos.length} TODO(s) pendente(s) — Stripe IDs faltando. Cheque os warnings acima.`
			);
		}
	} catch (error) {
		logger.error('sync falhou', error as Error);
		process.exitCode = 1;
	} finally {
		await app.close();
	}
}

main();
