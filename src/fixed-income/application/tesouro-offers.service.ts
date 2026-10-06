import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { todayInSaoPaulo } from 'src/macro-indicators/application/macro-series.service';
import { daysBetween } from '../domain/dates';
import { FIXED_INCOME_CLOCK } from './fixed-income-clock';
import {
	type StoredTesouroOffers,
	TESOURO_OFFERS_SOURCE,
	TESOURO_OFFERS_STORE,
	type TesouroOffersSource,
	type TesouroOffersStore,
} from './ports/tesouro-offers.ports';

/**
 * Pregão mais antigo que isto deixa de ser "taxa de hoje". Fim de semana e
 * feriado prolongado não passam de 5 dias; sete dá folga sem esconder um job
 * parado.
 */
const STALE_AFTER_DAYS = 7;

export interface TesouroOffers extends StoredTesouroOffers {
	stale: boolean;
}

/**
 * Títulos do Tesouro Direto servidos do banco. A fonte só é chamada pelo job
 * de leitura e, uma única vez, quando nada foi guardado ainda — assim o
 * Tesouro Transparente sai do caminho de cada requisição e, se ele cair, a
 * tela segue com o último pregão (marcado como desatualizado quando passa de
 * uma semana) em vez de ficar sem nada.
 */
@Injectable()
export class TesouroOffersService {
	private readonly logger = new Logger(TesouroOffersService.name);
	private inFlightRefresh: Promise<StoredTesouroOffers> | null = null;

	constructor(
		@Inject(TESOURO_OFFERS_SOURCE) private readonly source: TesouroOffersSource,
		@Inject(TESOURO_OFFERS_STORE) private readonly store: TesouroOffersStore,
		@Optional()
		@Inject(FIXED_INCOME_CLOCK)
		private readonly clock?: () => Date
	) {}

	private now(): Date {
		return this.clock ? this.clock() : new Date();
	}

	/** `null` quando nunca houve leitura e a fonte também não respondeu. */
	async getOffers(): Promise<TesouroOffers | null> {
		let stored = await this.store.load();
		if (!stored) {
			try {
				stored = await this.refresh();
			} catch (error) {
				this.logger.warn(
					`Carga inicial do Tesouro falhou: ${(error as Error)?.message || error}`
				);
				return null;
			}
		}
		const today = todayInSaoPaulo(this.now());
		return {
			...stored,
			stale: daysBetween(stored.baseDate, today) > STALE_AFTER_DAYS,
		};
	}

	/** Chamadas simultâneas compartilham a mesma leitura da fonte. */
	refresh(): Promise<StoredTesouroOffers> {
		if (this.inFlightRefresh) return this.inFlightRefresh;
		const task = this.runRefresh().finally(() => {
			this.inFlightRefresh = null;
		});
		this.inFlightRefresh = task;
		return task;
	}

	private async runRefresh(): Promise<StoredTesouroOffers> {
		const snapshot = await this.source.fetchLatest();
		const current = await this.store.load();
		// Nunca troca um pregão por outro mais antigo (arquivo republicado
		// com atraso, cache de borda...).
		if (current && current.baseDate > snapshot.baseDate) return current;

		const fetchedAt = this.now();
		await this.store.save(snapshot, fetchedAt);
		return { ...snapshot, fetchedAt };
	}
}
