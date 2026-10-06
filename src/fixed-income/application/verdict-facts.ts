import { createHash } from 'node:crypto';
import type { ComparisonResult } from './comparison.types';

/**
 * Fatos já fechados que o trackerr-ia recebe para escrever o veredito. A IA só
 * escreve prosa em cima deles: não calcula, não busca dado, não escolhe o
 * vencedor. Também é a base da validação — tudo que o texto citar precisa
 * estar aqui.
 */
export interface VerdictFacts {
	scenario: {
		principal: number;
		years: number;
		cdiPct: number;
		ipcaPct: number;
		irRatePct: number;
	};
	/** Do maior para o menor retorno real. */
	ranking: Array<{
		name: string;
		kind: string;
		exempt: boolean;
		grossAnnualPct: number;
		netAnnualPct: number;
		realAnnualPct: number;
		netFinal: number;
	}>;
	/** Leitura determinística do cenário (a mesma exibida na tela). */
	points: string[];
}

const round = (value: number) => Math.round(value * 100) / 100;

export function buildVerdictFacts(result: ComparisonResult): VerdictFacts {
	const { scenario } = result;
	return {
		scenario: {
			principal: round(scenario.principal),
			years: scenario.years,
			cdiPct: round(scenario.cdi.valuePct),
			ipcaPct: round(scenario.ipca.valuePct),
			irRatePct: scenario.irRatePct,
		},
		ranking: [...result.rows]
			.sort((a, b) => b.realAnnualPct - a.realAnnualPct)
			.map((row) => ({
				name: row.name,
				kind: row.kind,
				exempt: row.exempt,
				grossAnnualPct: round(row.grossAnnualPct),
				netAnnualPct: round(row.netAnnualPct),
				realAnnualPct: round(row.realAnnualPct),
				netFinal: round(row.netFinal),
			})),
		points: result.analysis.points.map((point) => point.text),
	};
}

/** Mesmos fatos → mesma chave: o veredito de um cenário é reaproveitado. */
export function hashVerdictFacts(facts: VerdictFacts): string {
	return createHash('sha256').update(JSON.stringify(facts)).digest('hex');
}
