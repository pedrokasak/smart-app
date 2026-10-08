import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AssetModel } from 'src/assets/schema/assets.model';
import { TradeModel } from 'src/fiscal/schema/trade.model';
import { DailyClosesAdminController } from './admin/daily-closes-admin.controller';
import { AssetBetaService } from './application/asset-beta.service';
import {
	DAILY_CLOSES_CONFIG,
	loadDailyClosesConfig,
} from './application/daily-closes.config';
import { DailyClosesIngestService } from './application/daily-closes-ingest.service';
import { DailyClosesJobService } from './application/daily-closes-job.service';
import { DailyClosesScheduler } from './application/daily-closes.scheduler';
import {
	ASSET_BETA_WRITER,
	COTAHIST_SOURCE,
	DAILY_CLOSE_STORE,
	HELD_SYMBOLS_READER,
} from './application/ports';
import { B3CotahistSource } from './infrastructure/b3-cotahist.source';
import {
	DAILY_CLOSE_COVERAGE_MODEL,
	DAILY_CLOSE_MODEL,
	dailyCloseCoverageSchema,
	dailyCloseSchema,
} from './infrastructure/daily-close.model';
import { MongoAssetBetaWriter } from './infrastructure/mongo-asset-beta.writer';
import { MongoDailyCloseStore } from './infrastructure/mongo-daily-close.store';
import { MongoHeldSymbolsReader } from './infrastructure/mongo-held-symbols.reader';

/**
 * Histórico diário de preços via COTAHIST da B3 (TRA-251): fonte oficial, sem
 * limite de taxa, gravada em `daily_closes`. Alimenta o histórico da carteira
 * e o beta por ativo sem depender do Yahoo, que responde 429 a partir da VPS.
 */
@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: DAILY_CLOSE_MODEL, schema: dailyCloseSchema },
			{ name: DAILY_CLOSE_COVERAGE_MODEL, schema: dailyCloseCoverageSchema },
			{ name: 'Asset', schema: AssetModel.schema },
			{ name: 'Trade', schema: TradeModel.schema },
		]),
	],
	controllers: [DailyClosesAdminController],
	providers: [
		{ provide: DAILY_CLOSES_CONFIG, useFactory: () => loadDailyClosesConfig() },
		MongoDailyCloseStore,
		{ provide: DAILY_CLOSE_STORE, useExisting: MongoDailyCloseStore },
		B3CotahistSource,
		{ provide: COTAHIST_SOURCE, useExisting: B3CotahistSource },
		MongoHeldSymbolsReader,
		{ provide: HELD_SYMBOLS_READER, useExisting: MongoHeldSymbolsReader },
		MongoAssetBetaWriter,
		{ provide: ASSET_BETA_WRITER, useExisting: MongoAssetBetaWriter },
		DailyClosesIngestService,
		AssetBetaService,
		DailyClosesJobService,
		DailyClosesScheduler,
	],
	exports: [DAILY_CLOSE_STORE],
})
export class DailyClosesModule {}
