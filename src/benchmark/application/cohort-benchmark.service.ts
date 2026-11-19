import { Inject, Injectable, Logger } from '@nestjs/common';
import {
	COHORT_SOURCE,
	type CohortSourcePort,
	type IneligibleReason,
} from 'src/benchmark/application/cohort-source.port';
import {
	COHORT_BENCHMARK_STORE,
	type CohortBenchmarkStore,
} from 'src/benchmark/application/cohort-benchmark-store.port';
import {
	MIN_HISTORY_MONTHS,
	type CohortLevel,
	type CohortMember,
	type CohortStats,
	type WealthBand,
} from 'src/benchmark/domain/cohort';
import { aggregateCohorts } from 'src/benchmark/domain/cohort-aggregation';
import {
	positionIn,
	type PositionBand,
} from 'src/benchmark/domain/position-band';
import { roundReturnPp, roundScore } from 'src/benchmark/domain/percentiles';

export type CohortBenchmarkResponse =
	| {
			available: false;
			reason: IneligibleReason | 'cohort_not_published';
			minHistoryMonths: number;
	  }
	| {
			available: true;
			period: string;
			cohort: {
				level: CohortLevel;
				wealthBands: WealthBand[];
				/** Aproximado, de 10 em 10: "50 ou mais". */
				sampleSizeBucket: number;
			};
			score: CohortStats & { you: { value: number; position: PositionBand } };
			/** Em pontos percentuais. */
			return12m: CohortStats & {
				you: { valuePp: number; position: PositionBand };
			};
			minHistoryMonths: number;
	  };

/**
 * Benchmark comparativo do Score (ADR-003, TRA-60).
 *
 * O job mensal agrega as carteiras e grava só o agregado. A consulta devolve
 * o agregado da coorte de QUEM PEDE, mais a posição dessa própria pessoa em
 * faixas. Nenhum dado de outro usuário passa por aqui.
 */
@Injectable()
export class CohortBenchmarkService {
	private readonly logger = new Logger(CohortBenchmarkService.name);

	constructor(
		@Inject(COHORT_SOURCE) private readonly source: CohortSourcePort,
		@Inject(COHORT_BENCHMARK_STORE)
		private readonly store: CohortBenchmarkStore
	) {}

	/** Calcula e publica o período. Devolve só contagens, nunca membros. */
	async publishPeriod(
		now: Date = new Date()
	): Promise<{ members: number; cohorts: number }> {
		const period = now.toISOString().slice(0, 7);
		const members: CohortMember[] = [];
		for await (const member of this.source.members()) members.push(member);

		const benchmarks = aggregateCohorts(members);
		await this.store.replacePeriod(period, benchmarks);
		this.logger.log(
			`Benchmark ${period}: ${members.length} carteira(s), ${benchmarks.length} coorte(s) publicada(s).`
		);
		return { members: members.length, cohorts: benchmarks.length };
	}

	async getForUser(userId: string): Promise<CohortBenchmarkResponse> {
		const lookup = await this.source.memberFor(userId);
		if (!('member' in lookup)) {
			return {
				available: false,
				reason: lookup.reason,
				minHistoryMonths: MIN_HISTORY_MONTHS,
			};
		}

		const { member } = lookup;
		const published = await this.store.latestFor(
			member.level,
			member.wealthBand
		);
		if (!published) {
			return {
				available: false,
				reason: 'cohort_not_published',
				minHistoryMonths: MIN_HISTORY_MONTHS,
			};
		}

		const { benchmark, period } = published;
		const scoreValue = roundScore(member.diversificationScore);
		const returnPp = roundReturnPp(member.return12m);
		return {
			available: true,
			period,
			cohort: {
				level: benchmark.level,
				wealthBands: benchmark.wealthBands,
				sampleSizeBucket: benchmark.sampleSizeBucket,
			},
			score: {
				...benchmark.score,
				you: {
					value: scoreValue,
					position: positionIn(scoreValue, benchmark.score),
				},
			},
			return12m: {
				...benchmark.return12mPp,
				you: {
					valuePp: returnPp,
					position: positionIn(returnPp, benchmark.return12mPp),
				},
			},
			minHistoryMonths: MIN_HISTORY_MONTHS,
		};
	}
}
