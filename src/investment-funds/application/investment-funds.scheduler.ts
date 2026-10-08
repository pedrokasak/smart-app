import {
	Inject,
	Injectable,
	Logger,
	OnApplicationBootstrap,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InvestmentFundIngestionService } from './investment-fund-ingestion.service';
import {
	INVESTMENT_FUND_STORE,
	InvestmentFundStore,
} from './ports/investment-funds.ports';

/**
 * Leitura dos dados abertos de fundos da CVM (TRA-276).
 *
 * A CVM regrava os arquivos de madrugada (os zips de 08/10/2026 saíram entre
 * 00h55 e 01h18). Cadastro às 06h50; cotas às 07h20 e às 19h20, a segunda
 * cobrindo atraso de publicação. Tudo idempotente por hash, então rodar em
 * mais de uma instância não duplica nada.
 *
 * Na subida, se o cadastro está vazio (primeiro deploy), carrega tudo em
 * segundo plano para a busca não ficar vazia até a manhã seguinte.
 */
@Injectable()
export class InvestmentFundsScheduler implements OnApplicationBootstrap {
	private readonly logger = new Logger(InvestmentFundsScheduler.name);

	constructor(
		private readonly ingestion: InvestmentFundIngestionService,
		@Inject(INVESTMENT_FUND_STORE)
		private readonly store: InvestmentFundStore
	) {}

	onApplicationBootstrap(): void {
		if (process.env.NODE_ENV === 'test') return;
		void this.warmUpIfEmpty();
	}

	@Cron('50 6 * * *', {
		name: 'investment-funds-registry',
		timeZone: 'America/Sao_Paulo',
	})
	async refreshRegistry(): Promise<void> {
		try {
			const stored = await this.ingestion.refreshRegistry();
			this.logger.log(
				stored === null
					? 'Cadastro de fundos da CVM sem mudança'
					: `Cadastro de fundos da CVM atualizado: ${stored} classe(s)`
			);
		} catch (error) {
			this.logger.error(
				`Leitura do cadastro de fundos falhou: ${(error as Error)?.message || error}`
			);
		}
	}

	@Cron('20 7,19 * * *', {
		name: 'investment-funds-quotes',
		timeZone: 'America/Sao_Paulo',
	})
	async refreshQuotes(): Promise<void> {
		try {
			const results = await this.ingestion.refreshQuotes();
			this.logger.log(
				`Cotas de fundos da CVM: ${results
					.map((r) =>
						r.status === 'parsed'
							? `${r.competence} ${r.stored} gravada(s) até ${r.latestDate}`
							: `${r.competence} ${r.status}`
					)
					.join('; ')}`
			);
		} catch (error) {
			this.logger.error(
				`Leitura das cotas de fundos falhou: ${(error as Error)?.message || error}`
			);
		}
	}

	private async warmUpIfEmpty(): Promise<void> {
		try {
			if ((await this.store.countClasses()) > 0) return;
			this.logger.log('Cadastro de fundos vazio: primeira carga da CVM');
			await this.refreshRegistry();
			await this.refreshQuotes();
		} catch (error) {
			this.logger.error(
				`Primeira carga de fundos falhou: ${(error as Error)?.message || error}`
			);
		}
	}
}
