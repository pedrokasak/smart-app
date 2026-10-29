import { Logger, Module } from '@nestjs/common';
import { b3InvestorEnv } from 'src/env';
import { B3_INVESTOR_DATA } from './application/b3-investor-data.port';
import { createB3InvestorData } from './infrastructure/b3-investor-data.factory';
import { loadB3InvestorConfig } from './infrastructure/b3-investor.config';

/**
 * Integração com a API oficial da Área do Investidor da B3 (TRA-185).
 *
 * Fase 1: só o cliente (`B3_INVESTOR_DATA`). Ainda não há rota, job nem
 * fluxo de opt-in usando este módulo.
 */
@Module({
	providers: [
		{
			provide: B3_INVESTOR_DATA,
			useFactory: () => {
				const logger = new Logger('B3InvestorModule');
				return createB3InvestorData(
					loadB3InvestorConfig(b3InvestorEnv),
					(reason) => logger.warn(reason)
				);
			},
		},
	],
	exports: [B3_INVESTOR_DATA],
})
export class B3InvestorModule {}
