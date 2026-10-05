import { Global, Module } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { FixedIncomeComparisonService } from './application/fixed-income-comparison.service';
import { FixedIncomeRatesService } from './application/fixed-income-rates.service';
import { FixedIncomeVerdictService } from './application/fixed-income-verdict.service';
import {
	TESOURO_OFFERS_SOURCE,
	TESOURO_OFFERS_STORE,
} from './application/ports/tesouro-offers.ports';
import { VERDICT_NARRATOR } from './application/ports/verdict-narrator.port';
import { TesouroOffersScheduler } from './application/tesouro-offers.scheduler';
import { FixedIncomeController } from './fixed-income.controller';
import { FixedIncomeModule } from './fixed-income.module';
import { MongoTesouroOffersStore } from './infrastructure/mongo-tesouro-offers.store';
import { TesouroTransparenteCsvSource } from './infrastructure/tesouro-transparente-csv.source';
import { TrackerrIaVerdictNarratorAdapter } from './infrastructure/trackerr-ia-verdict-narrator.adapter';

/** Conexão de mentira: o `forFeature` só precisa de algo que devolva um model. */
@Global()
@Module({
	providers: [
		{
			provide: getConnectionToken(),
			useValue: { models: {}, model: () => ({}) },
		},
	],
	exports: [getConnectionToken()],
})
class FakeMongooseConnectionModule {}

/**
 * Sobe o grafo REAL de injeção do módulo (com o macro-indicators dentro), só
 * sem banco. Teste de unidade com mocks não pega provider esquecido, token
 * sem `useExisting` ou import faltando — isto pega, antes do deploy.
 */
describe('FixedIncomeModule (injeção de dependência)', () => {
	it('resolve controller, serviços, portas e agendador', async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [FakeMongooseConnectionModule, FixedIncomeModule],
		}).compile();

		expect(moduleRef.get(FixedIncomeController)).toBeInstanceOf(
			FixedIncomeController
		);
		expect(moduleRef.get(FixedIncomeRatesService)).toBeDefined();
		expect(moduleRef.get(FixedIncomeComparisonService)).toBeDefined();
		expect(moduleRef.get(FixedIncomeVerdictService)).toBeDefined();
		expect(moduleRef.get(TesouroOffersScheduler)).toBeDefined();

		// Cada porta aponta para o adaptador de verdade.
		expect(moduleRef.get(TESOURO_OFFERS_STORE)).toBeInstanceOf(
			MongoTesouroOffersStore
		);
		expect(moduleRef.get(TESOURO_OFFERS_SOURCE)).toBeInstanceOf(
			TesouroTransparenteCsvSource
		);
		expect(moduleRef.get(VERDICT_NARRATOR)).toBeInstanceOf(
			TrackerrIaVerdictNarratorAdapter
		);
		expect(
			moduleRef.get(getModelToken('TesouroOffersSnapshot'), { strict: false })
		).toBeDefined();
	});
});
