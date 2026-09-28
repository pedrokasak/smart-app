import { MODULE_METADATA } from '@nestjs/common/constants';
import { RI_SUMMARY_CACHE } from 'src/ri-intelligence/application/ri-summary-cache.port';
import { RI_SUMMARY_SYNTHESIZER } from 'src/ri-intelligence/application/ri-summary-synthesizer.port';
import { MongoRiSummaryCacheAdapter } from 'src/ri-intelligence/infrastructure/mongo-ri-summary-cache.adapter';
import { TrackerrIaRiSummarySynthesizerAdapter } from 'src/ri-intelligence/infrastructure/trackerr-ia-ri-summary-synthesizer.adapter';
import { RiIntelligenceModule } from 'src/ri-intelligence/ri-intelligence.module';

/**
 * Trava de wiring do resumo de RI (TRA-238).
 *
 * `RiDocumentSummaryService` injeta o sintetizador com `@Optional()` — de
 * proposito, pra ambiente sem IA subir. O efeito colateral e que esquecer
 * de registrar o provider nao quebra nada: o grafo resolve, o
 * `app.module.di.spec` fica verde, e todo resumo cai calado no fallback
 * estruturado. Foi exatamente assim que o RI Inteligente ficou sem IA.
 */
describe('RiIntelligenceModule — wiring do resumo por IA (TRA-238)', () => {
	const providers: any[] =
		Reflect.getMetadata(MODULE_METADATA.PROVIDERS, RiIntelligenceModule) ?? [];

	const providerFor = (token: symbol) =>
		providers.find(
			(provider) => typeof provider === 'object' && provider?.provide === token
		);

	it('registra o sintetizador do trackerr-ia', () => {
		const provider = providerFor(RI_SUMMARY_SYNTHESIZER);

		expect(provider).toBeDefined();
		expect(provider.useExisting ?? provider.useClass).toBe(
			TrackerrIaRiSummarySynthesizerAdapter
		);
	});

	it('usa cache persistente, nao em memoria', () => {
		const provider = providerFor(RI_SUMMARY_CACHE);

		expect(provider).toBeDefined();
		expect(provider.useExisting ?? provider.useClass).toBe(
			MongoRiSummaryCacheAdapter
		);
	});
});
