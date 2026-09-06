import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Portfolio } from 'src/portfolio/schema/portfolio.model';
import { THRESHOLD_SYSTEM_POLICY } from 'src/thresholds/application/ports/threshold-policy.port';
import { ResolvedThresholdPolicy } from 'src/thresholds/domain/threshold.types';
import { QuoteRefreshService } from './quote-refresh.service';
import { QuoteStaleProducer } from './quote-stale.producer';

/**
 * Os dois relogios do frescor de cotacao (TRA-136, fase 7).
 *
 * REFRESH (a cada 6h). E o que gera o sinal. Le a cotacao de todo simbolo
 * carregado por alguem e carimba as leituras que deram certo. Sem ele nao
 * ha nada para medir: o provider so era chamado sob demanda e nao deixava
 * rastro. A cada 6h um simbolo saudavel e carimbado 4x/dia, entao a idade
 * da leitura fica sempre bem abaixo do corte — a idade so cresce quando as
 * leituras COMECAM A FALHAR, que e precisamente o fato a reportar.
 *
 * AVALIACAO (1x/dia). E o que publica. Diaria, e nao a cada refresh, por
 * duas razoes: o corte padrao e de 24h, entao avaliar 4x/dia so repetiria a
 * mesma conclusao; e a avaliacao varre carteira por usuario, trabalho que
 * nao se paga rodar de hora em hora para produzir o mesmo evento.
 *
 * Roda depois do refresh das 6h da manha (7h30) para avaliar sobre o
 * carimbo mais recente do dia.
 *
 * O corte usado pelo produtor e o default do SISTEMA. Consequencia
 * conhecida: um usuario que baixe `quoteStaleAfterMinutes` no proprio
 * override recebe o aviso a partir da janela do sistema, nao da dele — o
 * override so consegue ADIAR o alerta, nunca antecipa-lo. Publicar por
 * usuario com o corte de cada um exigiria ler a politica de todo mundo a
 * cada varredura para, na maioria dos casos, chegar ao mesmo numero.
 */
@Injectable()
export class QuoteFreshnessScheduler {
	private readonly logger = new Logger(QuoteFreshnessScheduler.name);

	constructor(
		@InjectModel('Portfolio')
		private readonly portfolioModel: Model<Portfolio>,
		private readonly refresh: QuoteRefreshService,
		private readonly producer: QuoteStaleProducer,
		@Inject(THRESHOLD_SYSTEM_POLICY)
		private readonly systemPolicy: ResolvedThresholdPolicy
	) {}

	@Cron('0 */6 * * *', {
		name: 'market-quote-refresh',
		timeZone: 'America/Sao_Paulo',
	})
	async runRefresh(): Promise<void> {
		try {
			const result = await this.refreshHeldSymbols();
			this.logger.log(
				`Refresh de cotacao: ${result.stamped}/${result.requested} simbolo(s) carimbado(s)`
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.logger.error(`Refresh de cotacao falhou: ${message}`);
		}
	}

	@Cron('30 7 * * *', {
		name: 'market-quote-staleness',
		timeZone: 'America/Sao_Paulo',
	})
	async runEvaluation(): Promise<void> {
		try {
			const published = await this.evaluate(new Date());
			this.logger.log(
				`Frescor de cotacao: ${published} evento(s) publicado(s)`
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.logger.error(`Avaliacao de frescor de cotacao falhou: ${message}`);
		}
	}

	/** Extraido para teste. Atualiza a cotacao dos simbolos em carteira. */
	async refreshHeldSymbols(now: Date = new Date()) {
		const symbols = await this.producer.heldSymbols();
		return this.refresh.refresh(symbols, now);
	}

	/** Extraido para teste. Devolve quantos eventos foram publicados. */
	async evaluate(now: Date): Promise<number> {
		const rawIds: unknown[] = await this.portfolioModel
			.distinct('userId')
			.exec();

		let published = 0;
		for (const rawId of rawIds) {
			const userId = String(rawId ?? '');
			if (!userId) continue;

			// Sequencial pelo mesmo motivo do `PortfolioEvaluationScheduler`:
			// e um passe de leitura por usuario, uma vez ao dia.
			published += await this.producer.evaluateForUser(
				userId,
				this.systemPolicy.quoteStaleAfterMinutes,
				now
			);
		}

		return published;
	}
}
