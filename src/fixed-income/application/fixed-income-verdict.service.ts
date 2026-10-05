import { Inject, Injectable, Logger } from '@nestjs/common';
import { TtlPromiseCache } from 'src/macro-indicators/infrastructure/bcb-sgs/ttl-promise-cache';
import type { ComparisonRequest } from './comparison.types';
import { FixedIncomeComparisonService } from './fixed-income-comparison.service';
import {
	VERDICT_NARRATOR,
	type VerdictNarratorPort,
} from './ports/verdict-narrator.port';
import {
	type VerdictFacts,
	buildVerdictFacts,
	hashVerdictFacts,
} from './verdict-facts';
import { validateVerdictText } from './verdict-validator';

export interface FixedIncomeVerdict {
	text: string;
	/** `ai` = prosa do trackerr-ia, validada; `rules` = texto determinístico. */
	source: 'ai' | 'rules';
}

/** Cenários iguais (mesmos fatos) reaproveitam a prosa por este tempo. */
const VERDICT_TTL_MS = 6 * 60 * 60 * 1000;
const VERDICT_CACHE_MAX_ENTRIES = 200;

class NarrationRejected extends Error {}

/**
 * Veredito do comparador (TRA-269). O server calcula os fatos, o trackerr-ia
 * escreve a prosa e o server confere o texto contra os mesmos fatos. Sem IA,
 * IA lenta ou IA que cita número que não existe, vale o texto determinístico
 * — a tela nunca fica sem veredito e nunca exibe um que contradiga a tabela.
 *
 * Só a prosa validada é guardada: uma queda da IA não deixa o texto de regra
 * "preso" no cache, a próxima chamada tenta de novo.
 */
@Injectable()
export class FixedIncomeVerdictService {
	private readonly logger = new Logger(FixedIncomeVerdictService.name);
	private readonly cache = new TtlPromiseCache<string>(
		VERDICT_TTL_MS,
		VERDICT_CACHE_MAX_ENTRIES
	);

	constructor(
		private readonly comparison: FixedIncomeComparisonService,
		@Inject(VERDICT_NARRATOR) private readonly narrator: VerdictNarratorPort
	) {}

	async verdict(request: ComparisonRequest): Promise<FixedIncomeVerdict> {
		const result = await this.comparison.compare(request);
		const rulesText = result.analysis.headline;
		// Com um papel só não há o que comparar nem o que narrar.
		if (result.rows.length < 2) return { text: rulesText, source: 'rules' };

		const facts = buildVerdictFacts(result);
		try {
			const text = await this.cache.getOrLoad(hashVerdictFacts(facts), () =>
				this.narrate(facts)
			);
			return { text, source: 'ai' };
		} catch (error) {
			this.logger.warn(
				`Veredito por IA indisponível (${(error as Error)?.message || error}); usando o texto determinístico.`
			);
			return { text: rulesText, source: 'rules' };
		}
	}

	private async narrate(facts: VerdictFacts): Promise<string> {
		const text = await this.narrator.narrate(facts);
		if (text === null) throw new NarrationRejected('sem resposta da IA');

		const validation = validateVerdictText(text, facts);
		if (!validation.valid) {
			throw new NarrationRejected(`texto descartado (${validation.reason})`);
		}
		return text.trim();
	}
}
