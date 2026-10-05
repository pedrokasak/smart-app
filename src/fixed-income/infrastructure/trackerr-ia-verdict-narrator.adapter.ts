import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { trackerrIaHeaders } from 'src/ai/infrastructure/trackerr-ia-request';
import type { VerdictNarratorPort } from '../application/ports/verdict-narrator.port';
import type { VerdictFacts } from '../application/verdict-facts';

/**
 * Modelo gratuito demora de 5 a 25 s para escrever três frases (medido em
 * 05/10/2026). A tela já mostra o texto de regra enquanto espera, então vale
 * esperar um pouco mais pela prosa; passou disso, fica o texto de regra.
 */
const NARRATE_TIMEOUT_MS = 25_000;

/**
 * Chama POST /api/fixed-income/verdict no trackerr-ia. Nunca lança — qualquer
 * falha (rede, timeout, resposta sem texto) vira `null` e o chamador cai no
 * texto determinístico. A validação do que volta fica no serviço.
 *
 * Nenhum dado pessoal viaja: só o cenário e as taxas públicas da tabela.
 */
@Injectable()
export class TrackerrIaVerdictNarratorAdapter implements VerdictNarratorPort {
	private readonly logger = new Logger(TrackerrIaVerdictNarratorAdapter.name);
	private readonly trackerIaUrl =
		process.env.TRAKKER_IA_URL || 'http://localhost:8000';

	constructor(private readonly httpService: HttpService) {}

	async narrate(facts: VerdictFacts): Promise<string | null> {
		try {
			const response = await firstValueFrom(
				this.httpService.post<{ text?: string }>(
					`${this.trackerIaUrl}/api/fixed-income/verdict`,
					this.toPayload(facts),
					{ headers: trackerrIaHeaders(), timeout: NARRATE_TIMEOUT_MS }
				)
			);
			const text = response.data?.text;
			return typeof text === 'string' && text.trim() ? text : null;
		} catch (error) {
			this.logger.warn(
				`Falha ao narrar veredito via trackerr-ia: ${(error as Error)?.message || error}`
			);
			return null;
		}
	}

	private toPayload(facts: VerdictFacts) {
		return {
			scenario: {
				principal: facts.scenario.principal,
				years: facts.scenario.years,
				cdi_pct: facts.scenario.cdiPct,
				ipca_pct: facts.scenario.ipcaPct,
				ir_rate_pct: facts.scenario.irRatePct,
			},
			ranking: facts.ranking.map((row) => ({
				name: row.name,
				kind: row.kind,
				exempt: row.exempt,
				gross_annual_pct: row.grossAnnualPct,
				net_annual_pct: row.netAnnualPct,
				real_annual_pct: row.realAnnualPct,
				net_final: row.netFinal,
			})),
			points: facts.points,
		};
	}
}
