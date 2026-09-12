import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
	EVENT_PUBLISHER,
	EventPublisher,
} from 'src/events/application/ports/event-publisher.port';
import { createDomainEvent } from 'src/events/domain/domain-event.factory';
import { DOMAIN_EVENT_TYPES } from 'src/events/domain/event-types';
import { Asset } from 'src/assets/schema/assets.model';
import { Portfolio } from 'src/portfolio/schema/portfolio.model';

export type DividendEntry = {
	date: Date | string;
	value: number;
	paymentType?: string;
};

/** Proventos da B3 sao em real; o extrato nao carrega moeda. */
const DEFAULT_CURRENCY = 'BRL';

/**
 * Teto por chamada. Uma importacao de extrato anual pode trazer dezenas de
 * proventos do mesmo papel de uma vez; publicar todos viraria dezenas de
 * notificacoes sobre um fato unico ("importei meu extrato"). O corte fica
 * aqui, no produtor, porque quem sabe que a origem e um lote e ele.
 *
 * TODO(TRA-136 fase 4): o motor de limiares deve agrupar por periodo em vez
 * de cortar — "voce recebeu R$ X em N proventos" e melhor que N eventos.
 */
const MAX_EVENTS_PER_CALL = 5;

/**
 * Produtor de `portfolio.dividend.received` (TRA-136, fase 3).
 *
 * Depende SO da porta EventPublisher — nunca de bullmq/ioredis. Onde o
 * evento vai parar (fila, e-mail, push) e problema de quem assina.
 *
 * `publish` nunca lanca. O criterio de aceite e explicito: com o Redis
 * fora do ar o provento continua sendo gravado e a rota continua 200. Um
 * evento perdido e um aviso a menos; uma excecao aqui seria uma
 * importacao quebrada.
 *
 * O `userId` nao esta no Asset: vem do Portfolio dono. A resolucao mora
 * aqui e nao no AssetsService para nao empurrar consulta de dono para
 * dentro de um caso de uso que nao precisa dela.
 */
@Injectable()
export class DividendReceivedProducer {
	private readonly logger = new Logger(DividendReceivedProducer.name);

	constructor(
		@Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
		@InjectModel('Asset') private readonly assetModel: Model<Asset>,
		@InjectModel('Portfolio') private readonly portfolioModel: Model<Portfolio>
	) {}

	/**
	 * Publica um evento por provento efetivamente novo. Chamado depois da
	 * persistencia: o evento afirma um fato ja gravado.
	 */
	async publishForAsset(
		assetId: string,
		entries: DividendEntry[]
	): Promise<void> {
		try {
			const novos = entries.filter((entry) => Number(entry?.value) > 0);
			if (novos.length === 0) return;

			const asset = await this.assetModel
				.findById(assetId)
				.select('symbol portfolioId')
				.lean<{ symbol?: string; portfolioId?: unknown } | null>();
			if (!asset?.symbol || !asset.portfolioId) {
				this.logger.warn(
					`Provento sem ativo resolvivel (assetId=${assetId}) — evento nao publicado`
				);
				return;
			}

			const portfolio = await this.portfolioModel
				.findById(asset.portfolioId)
				.select('userId')
				.lean<{ userId?: unknown } | null>();
			const userId = portfolio?.userId ? String(portfolio.userId) : '';
			if (!userId) {
				this.logger.warn(
					`Carteira ${String(asset.portfolioId)} sem dono — evento de provento nao publicado`
				);
				return;
			}

			const publicaveis = novos.slice(0, MAX_EVENTS_PER_CALL);
			if (novos.length > publicaveis.length) {
				this.logger.log(
					`${novos.length} proventos novos em ${asset.symbol}; publicando ${publicaveis.length} (lote de importacao)`
				);
			}

			for (const entry of publicaveis) {
				const occurredAt = toIsoDate(entry.date);
				await this.publisher.publish(
					createDomainEvent({
						type: DOMAIN_EVENT_TYPES.DividendReceived,
						subject: userId,
						producer: 'server.assets.dividends',
						// O fato ocorreu na data do provento, nao na do import.
						occurredAt,
						payload: {
							symbol: asset.symbol,
							amount: Number(entry.value),
							currency: DEFAULT_CURRENCY,
							receivedAt: occurredAt,
						},
					})
				);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.logger.error(
				`Falha ao publicar dividendo do ativo ${assetId}: ${message}`
			);
		}
	}
}

function toIsoDate(date: Date | string): string {
	const parsed = new Date(date);
	return Number.isNaN(parsed.getTime())
		? new Date().toISOString()
		: parsed.toISOString();
}
