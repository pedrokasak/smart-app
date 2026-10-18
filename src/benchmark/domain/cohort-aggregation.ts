import {
	COHORT_LEVELS,
	COHORT_MIN_MEMBERS,
	WEALTH_BANDS,
	type CohortBenchmark,
	type CohortLevel,
	type CohortMember,
	type CohortStats,
	type WealthBand,
} from 'src/benchmark/domain/cohort';
import {
	percentile,
	roundReturnPp,
	roundScore,
} from 'src/benchmark/domain/percentiles';

/**
 * Agrega as carteiras em coortes publicáveis (ADR-003, TRA-60).
 *
 * Regras de privacidade, na ordem em que valem:
 *  1. Coorte com menos de `minMembers` carteiras NUNCA é publicada.
 *  2. Antes de desistir, a faixa fina se funde com a vizinha do mesmo nível
 *     (baixa com média, média com alta). Fundir nunca cruza de nível.
 *  3. Os percentis saem arredondados (score inteiro, retorno em passos de
 *     0,5 p.p.), para a diferença entre dois meses não revelar um valor.
 *  4. Só o agregado sai: nenhum campo identifica ou ordena pessoas.
 */

interface Group {
	bands: WealthBand[];
	members: CohortMember[];
}

function statsOf(values: number[], round: (v: number) => number): CohortStats {
	const sorted = [...values].sort((a, b) => a - b);
	return {
		p25: round(percentile(sorted, 0.25)),
		p50: round(percentile(sorted, 0.5)),
		p75: round(percentile(sorted, 0.75)),
	};
}

/**
 * Funde grupos vizinhos até todos terem `minMembers`, ou sobrar um só.
 * Sempre atua sobre o menor grupo abaixo do limite, e o junta ao vizinho
 * menor (empate: o de faixa mais baixa).
 */
function mergeThinGroups(groups: Group[], minMembers: number): Group[] {
	const result = [...groups];
	while (result.length > 1) {
		let thinnest = -1;
		for (let i = 0; i < result.length; i++) {
			if (result[i].members.length >= minMembers) continue;
			if (
				thinnest === -1 ||
				result[i].members.length < result[thinnest].members.length
			) {
				thinnest = i;
			}
		}
		if (thinnest === -1) break;

		const left = thinnest > 0 ? thinnest - 1 : -1;
		const right = thinnest < result.length - 1 ? thinnest + 1 : -1;
		const neighbour =
			left === -1
				? right
				: right === -1
					? left
					: result[left].members.length <= result[right].members.length
						? left
						: right;

		const [first, second] =
			neighbour < thinnest ? [neighbour, thinnest] : [thinnest, neighbour];
		result.splice(first, 2, {
			bands: [...result[first].bands, ...result[second].bands],
			members: [...result[first].members, ...result[second].members],
		});
	}
	return result;
}

export function aggregateCohorts(
	members: readonly CohortMember[],
	minMembers: number = COHORT_MIN_MEMBERS
): CohortBenchmark[] {
	const published: CohortBenchmark[] = [];

	for (const level of COHORT_LEVELS as readonly CohortLevel[]) {
		const ofLevel = members.filter(
			(m) =>
				m.level === level &&
				Number.isFinite(m.diversificationScore) &&
				Number.isFinite(m.return12m)
		);
		const groups: Group[] = WEALTH_BANDS.map((band) => ({
			bands: [band],
			members: ofLevel.filter((m) => m.wealthBand === band),
		})).filter((g) => g.members.length > 0);

		for (const group of mergeThinGroups(groups, minMembers)) {
			if (group.members.length < minMembers) continue;
			published.push({
				level,
				wealthBands: group.bands,
				sampleSizeBucket: Math.floor(group.members.length / 10) * 10,
				score: statsOf(
					group.members.map((m) => m.diversificationScore),
					roundScore
				),
				return12mPp: statsOf(
					group.members.map((m) => m.return12m),
					roundReturnPp
				),
			});
		}
	}

	return published;
}
