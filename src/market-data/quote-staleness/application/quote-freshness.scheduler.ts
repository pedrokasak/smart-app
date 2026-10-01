import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Portfolio } from 'src/portfolio/schema/portfolio.model';
import { THRESHOLD_SYSTEM_POLICY } from 'src/thresholds/application/ports/threshold-policy.port';
import { ResolvedThresholdPolicy } from 'src/thresholds/domain/threshold.types';
import { QuoteRefreshService } from './quote-refresh.service';
import {
	HELD_ASSET_PRICE_WRITER,
	HeldAssetPriceWriter,
} from './ports/held-asset-price.port';
import {
	CRYPTO_QUOTE_SOURCE,
	CryptoQuoteSource,
} from './ports/crypto-quote.port';
import {
	QUOTE_FRESHNESS_STORE,
	QuoteFreshnessStore,
} from './ports/quote-freshness.port';
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
		private readonly systemPolicy: ResolvedThresholdPolicy,
		@Inject(HELD_ASSET_PRICE_WRITER)
		private readonly assetPrices: HeldAssetPriceWriter,
		@Inject(CRYPTO_QUOTE_SOURCE)
		private readonly cryptoQuotes: CryptoQuoteSource,
		@Inject(QUOTE_FRESHNESS_STORE)
		private readonly freshness: QuoteFreshnessStore
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

	/**
	 * Durante o pregão a cada hora (TRA-247): 6 em 6 horas deixava a carteira
	 * com o preço da manhã o dia inteiro. As chamadas à brapi passam pela fila
	 * de concorrência 1, então a varredura não disputa com as telas.
	 */
	@Cron('15 10-17 * * 1-5', {
		name: 'market-quote-refresh-trading-hours',
		timeZone: 'America/Sao_Paulo',
	})
	async runTradingHoursRefresh(): Promise<void> {
		await this.runRefresh();
	}

	/**
	 * Cripto negocia 24 h por dia, 7 dias por semana: nao segue o pregao da
	 * B3. Uma chamada a CoinGecko por rodada cabe folgado no limite publico.
	 */
	@Cron('*/15 * * * *', {
		name: 'crypto-quote-refresh',
		timeZone: 'America/Sao_Paulo',
	})
	async runCryptoRefresh(): Promise<void> {
		await this.refreshCrypto();
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
		const symbols = await this.producer.heldSymbols('market');
		const result = await this.refresh.refresh(symbols, now);
		// Falha ao gravar nas posicoes nao desfaz o carimbo: a leitura foi
		// real, e a proxima varredura tenta de novo.
		try {
			const updated = await this.assetPrices.applyLatestPrices(
				result.records,
				'market'
			);
			this.logger.log(`Cotacao aplicada em ${updated} posicao(oes)`);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.logger.error(`Falha ao aplicar cotacao nas posicoes: ${message}`);
		}
		await this.refreshCrypto();
		return result;
	}

	/**
	 * Cripto so pela CoinGecko (TRA-252). A cadeia de acoes resolvia "LUNC"
	 * num papel homonimo e gravava R$ 24,90 na Terra Classic.
	 */
	private async refreshCrypto(): Promise<void> {
		try {
			const symbols = await this.producer.heldSymbols('crypto');
			if (symbols.length === 0) return;
			const records = await this.cryptoQuotes.quote(symbols);
			if (records.length > 0) {
				await this.freshness.recordReads(records);
				await this.assetPrices.applyLatestPrices(records, 'crypto');
			}
			const cleared = await this.assetPrices.clearMisquotedCrypto(
				records.map((record) => record.symbol)
			);
			this.logger.log(
				`Cripto: ${records.length}/${symbols.length} cotada(s), ${cleared} preco(s) errado(s) desfeito(s)`
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.logger.error(`Refresh de cripto falhou: ${message}`);
		}
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
