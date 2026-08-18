import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { DigestNarratorPort } from 'src/notifications/portfolio-digest/application/digest-narrator.port';
import { validateDigestNarrative } from 'src/notifications/portfolio-digest/application/digest-narrative-validator';
import { PortfolioDigestFacts } from 'src/notifications/portfolio-digest/domain/portfolio-digest.types';

/**
 * Chama POST /api/portfolio-digest-narrate no trackerr-ia. Nunca lanca —
 * qualquer falha (rede, timeout, resposta invalida) vira null, e o
 * chamador cai no template deterministico. O trackerr-ia e tratado como
 * nao confiavel por design: a resposta e validada aqui contra os mesmos
 * fatos enviados antes de ser aceita (ver digest-narrative-validator.ts).
 */
@Injectable()
export class TrackerrIaDigestNarratorAdapter implements DigestNarratorPort {
	private readonly logger = new Logger(TrackerrIaDigestNarratorAdapter.name);
	private readonly trackerIaUrl =
		process.env.TRAKKER_IA_URL || 'http://localhost:8000';

	constructor(private readonly httpService: HttpService) {}

	async narrate(facts: PortfolioDigestFacts): Promise<string | null> {
		try {
			const response = await firstValueFrom(
				this.httpService.post<{ text: string }>(
					`${this.trackerIaUrl}/api/portfolio-digest-narrate`,
					this.toPayload(facts),
					{
						headers: { 'Content-Type': 'application/json' },
						// Job semanal em background, nao bloqueia request de usuario —
						// mas ainda precisa de teto pra nao travar o scheduler inteiro
						// num unico usuario se o trackerr-ia estiver lento.
						timeout: 8000,
					}
				)
			);

			const text = response.data?.text;
			const validation = validateDigestNarrative(text, facts);
			if (!validation.valid) {
				this.logger.warn(
					`Narrativa do digest descartada (${validation.reason}); usando fallback determinístico.`
				);
				return null;
			}

			return text;
		} catch (error) {
			this.logger.warn(
				`Falha ao narrar digest via trackerr-ia: ${error?.message}; usando fallback determinístico.`
			);
			return null;
		}
	}

	private toPayload(facts: PortfolioDigestFacts) {
		return {
			period_start: facts.periodStart,
			period_end: facts.periodEnd,
			portfolio_value: facts.portfolioValue,
			period_change_pct: facts.periodChangePct,
			period_change_abs: facts.periodChangeAbs,
			top_gainers: facts.topGainers.map((mover) => ({
				symbol: mover.symbol,
				change_percent: mover.changePercent,
			})),
			top_losers: facts.topLosers.map((mover) => ({
				symbol: mover.symbol,
				change_percent: mover.changePercent,
			})),
			watch_items: facts.watchItems.map((item) => ({
				symbol: item.symbol,
				reason: item.reason,
				detail: item.detail,
			})),
			dividends_received: facts.dividendsReceived,
		};
	}
}
