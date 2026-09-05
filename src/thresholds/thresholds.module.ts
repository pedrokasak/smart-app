import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserModel } from 'src/users/schema/user.model';
import { ThresholdEngineService } from './application/threshold-engine.service';
import {
	THRESHOLD_POLICY_STORE,
	THRESHOLD_SYSTEM_POLICY,
} from './application/ports/threshold-policy.port';
import { THRESHOLD_STATE_STORE } from './application/ports/threshold-state.port';
import { MongoThresholdPolicyRepository } from './infrastructure/mongo-threshold-policy.repository';
import { MongoThresholdStateRepository } from './infrastructure/mongo-threshold-state.repository';
import { ThresholdStateModel } from './infrastructure/threshold-state.model';
import { loadSystemThresholdPolicy } from './infrastructure/thresholds.config';

/**
 * Motor de limiares (TRA-136, fase 4).
 *
 * Modulo proprio, e nao uma pasta dentro de `notifications`, porque a
 * decisao "isto merece ser contado ao usuario" nao e do dominio de
 * notificacao: e do dominio que produziu o numero. Notificacao e so o
 * primeiro consumidor da decisao — um painel de alertas ou um digest
 * semanal usariam o mesmo motor sem passar por canal nenhum.
 *
 * Nao exporta os adaptadores: quem consome ve `ThresholdEngineService` e
 * mais nada.
 */
@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'ThresholdState', schema: ThresholdStateModel.schema },
			// Registrado localmente so para ler `User.thresholdPolicy`. Mesmo
			// schema — o Mongoose deduplica por nome, entao nao ha colecao
			// paralela nem import de UsersModule.
			{ name: 'User', schema: UserModel.schema },
		]),
	],
	providers: [
		MongoThresholdStateRepository,
		MongoThresholdPolicyRepository,
		{
			provide: THRESHOLD_STATE_STORE,
			useExisting: MongoThresholdStateRepository,
		},
		{
			provide: THRESHOLD_POLICY_STORE,
			useExisting: MongoThresholdPolicyRepository,
		},
		{ provide: THRESHOLD_SYSTEM_POLICY, useFactory: loadSystemThresholdPolicy },
		ThresholdEngineService,
	],
	exports: [ThresholdEngineService],
})
export class ThresholdsModule {}
