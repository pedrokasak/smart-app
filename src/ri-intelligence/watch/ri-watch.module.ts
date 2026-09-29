import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { assetSchema } from 'src/assets/schema/assets.model';
import { CvmRiDocumentDiscoveryAdapter } from 'src/ri-intelligence/infrastructure/cvm-ri-document-discovery.adapter';
import { RiIntelligenceModule } from 'src/ri-intelligence/ri-intelligence.module';
import { HELD_TICKER_DIRECTORY } from './application/ports/held-ticker-directory.port';
import { RI_WATCH_DISCOVERY } from './application/ports/ri-watch-discovery.port';
import { RI_WATCH_STORE } from './application/ports/ri-watch-store.port';
import {
	loadRiWatchConfig,
	RI_WATCH_CONFIG,
} from './application/ri-watch.config';
import { RiWatchScheduler } from './application/ri-watch.scheduler';
import { RiWatchService } from './application/ri-watch.service';
import { MongoHeldTickerDirectory } from './infrastructure/mongo-held-ticker-directory';
import { MongoRiWatchRepository } from './infrastructure/mongo-ri-watch.repository';
import { RiWatchDocumentModel } from './infrastructure/ri-watch-document.model';

/**
 * Vigia de RI (TRA-240), etapa 1: descobrir documentos novos dos tickers em
 * carteira e pre-gerar o resumo verificado.
 *
 * Modulo proprio, e nao mais uma pasta de providers dentro do
 * `RiIntelligenceModule`: a dependencia so anda num sentido — o vigia usa a
 * descoberta, o conteudo e o resumo do RI; o RI nao sabe que o vigia existe.
 * As proximas etapas (notificacao, acervo no RAG) entram aqui.
 *
 * Asset e registrado localmente (mesmo schema; o Mongoose deduplica por
 * nome, entao nao ha colecao paralela).
 */
@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'RiWatchDocument', schema: RiWatchDocumentModel.schema },
			{ name: 'Asset', schema: assetSchema },
		]),
		RiIntelligenceModule,
	],
	providers: [
		MongoRiWatchRepository,
		{ provide: RI_WATCH_STORE, useExisting: MongoRiWatchRepository },
		MongoHeldTickerDirectory,
		{ provide: HELD_TICKER_DIRECTORY, useExisting: MongoHeldTickerDirectory },
		// So a fonte oficial: ver `ri-watch-discovery.port.ts`.
		{ provide: RI_WATCH_DISCOVERY, useExisting: CvmRiDocumentDiscoveryAdapter },
		{ provide: RI_WATCH_CONFIG, useFactory: () => loadRiWatchConfig() },
		RiWatchService,
		RiWatchScheduler,
	],
})
export class RiWatchModule {}
