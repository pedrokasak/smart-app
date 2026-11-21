import { ApiProperty } from '@nestjs/swagger';
import type { ClientPortfolioMetrics } from 'src/advisor/application/metrics/build-portfolio-metrics';
import {
	AssetClass,
	LiquidityBucket,
	PortfolioProvenance,
	Provenance,
} from 'src/advisor/domain/enums';

const UNAVAILABLE = [
	'NO_TRANSACTIONS',
	'INCONSISTENT_LEDGER',
	'NO_PRICED_POSITIONS',
	'INSUFFICIENT_HISTORY',
];
const BENCHMARK_KEYS = ['CDI', 'IBOV', 'IPCA'];

const nullableNumber = { type: Number, nullable: true } as const;
const nullableString = { type: String, nullable: true } as const;
const unavailable = { enum: UNAVAILABLE, nullable: true } as const;

export class ValuedPositionDto {
	@ApiProperty()
	symbol: string;
	@ApiProperty({ enum: AssetClass })
	assetClass: AssetClass;
	@ApiProperty()
	quantity: number;
	@ApiProperty({ description: 'Centavos' })
	costMinor: number;
	@ApiProperty({ enum: Provenance })
	provenance: Provenance;
	@ApiProperty({ required: false })
	liquidityDays?: number;
	@ApiProperty({ description: 'A mercado; sem cotação, o custo (centavos)' })
	marketValueMinor: number;
	@ApiProperty()
	priced: boolean;
	@ApiProperty({ description: '0-100, sobre o total' })
	weightPct: number;
}

export class TopWeightDto {
	@ApiProperty()
	symbol: string;
	@ApiProperty()
	weightPct: number;
}

export class ConcentrationDto {
	@ApiProperty(nullableNumber)
	hhi: number | null;
	@ApiProperty(nullableNumber)
	effectiveAssets: number | null;
	@ApiProperty({ type: [TopWeightDto] })
	top: TopWeightDto[];
}

const percentByClass = {
	type: 'object',
	additionalProperties: { type: 'number' },
} as const;

export class AllocationDto {
	@ApiProperty({
		...percentByClass,
		description: 'Percentual atual por classe de ativo',
	})
	current: Record<AssetClass, number>;
	@ApiProperty({ ...percentByClass, nullable: true })
	target: Partial<Record<AssetClass, number>> | null;
	@ApiProperty({
		...percentByClass,
		nullable: true,
		description: 'Desvio atual menos meta, em pontos percentuais',
	})
	driftPp: Record<AssetClass, number> | null;
}

export class PerformanceDto {
	@ApiProperty(nullableNumber)
	twr: number | null;
	@ApiProperty(nullableNumber)
	twrAnnualized: number | null;
	@ApiProperty(nullableNumber)
	mwr: number | null;
	@ApiProperty(nullableNumber)
	mwrAnnualized: number | null;
	@ApiProperty(nullableString)
	measuredFrom: string | null;
	@ApiProperty(nullableString)
	measuredTo: string | null;
	@ApiProperty()
	observations: number;
	@ApiProperty({ description: '0-100' })
	coveragePct: number;
	@ApiProperty(unavailable)
	unavailable: string | null;
}

export class Var95Dto {
	@ApiProperty()
	pct: number;
	@ApiProperty({ description: 'Centavos' })
	amountMinor: number;
	@ApiProperty({ enum: [21] })
	horizonDays: 21;
}

export class RiskDto {
	@ApiProperty(nullableNumber)
	volatilityAnnualized: number | null;
	@ApiProperty(nullableNumber)
	maxDrawdown: number | null;
	@ApiProperty(nullableString)
	drawdownPeakDate: string | null;
	@ApiProperty(nullableString)
	drawdownTroughDate: string | null;
	@ApiProperty({ type: Var95Dto, nullable: true })
	var95: Var95Dto | null;
	@ApiProperty(unavailable)
	unavailable: string | null;
}

export class BenchmarkDto {
	@ApiProperty({ enum: BENCHMARK_KEYS })
	key: string;
	@ApiProperty(nullableNumber)
	periodReturn: number | null;
	@ApiProperty(nullableNumber)
	excess: number | null;
}

export class MetricsWarningsDto {
	@ApiProperty({ type: [String] })
	unpricedSymbols: string[];
	@ApiProperty({ type: [String] })
	ledgerInconsistencies: string[];
	@ApiProperty({ type: [String] })
	noHistorySymbols: string[];
}

export class MetricsResponseDto {
	@ApiProperty({ description: 'AAAA-MM-DD' })
	asOf: string;
	@ApiProperty({ enum: ['BRL'] })
	currency: 'BRL';
	@ApiProperty({ enum: PortfolioProvenance, nullable: true })
	provenance: PortfolioProvenance | null;
	@ApiProperty({ description: 'Centavos' })
	totalValueMinor: number;
	@ApiProperty({ type: [ValuedPositionDto] })
	positions: ValuedPositionDto[];
	@ApiProperty({ type: ConcentrationDto })
	concentration: ConcentrationDto;
	@ApiProperty({
		type: 'object',
		additionalProperties: { type: 'number' },
		description: `Percentual por faixa: ${Object.values(LiquidityBucket).join(', ')}`,
	})
	liquidity: Record<LiquidityBucket, number>;
	@ApiProperty({ type: AllocationDto })
	allocation: AllocationDto;
	@ApiProperty({ type: PerformanceDto })
	performance: PerformanceDto;
	@ApiProperty({ type: RiskDto })
	risk: RiskDto;
	@ApiProperty({ type: [BenchmarkDto] })
	benchmarks: BenchmarkDto[];
	@ApiProperty({ type: MetricsWarningsDto })
	warnings: MetricsWarningsDto;

	static of(m: ClientPortfolioMetrics): MetricsResponseDto {
		return {
			asOf: m.asOf,
			currency: m.currency,
			provenance: m.provenance,
			totalValueMinor: m.totalValueMinor,
			positions: m.positions.map((p) => ({ ...p })),
			concentration: {
				hhi: m.concentration.hhi,
				effectiveAssets: m.concentration.effectiveAssets,
				top: m.concentration.top.map((t) => ({ ...t })),
			},
			liquidity: { ...m.liquidity },
			allocation: {
				current: { ...m.allocation.current },
				target: m.allocation.target ? { ...m.allocation.target } : null,
				driftPp: m.allocation.driftPp ? { ...m.allocation.driftPp } : null,
			},
			performance: { ...m.performance },
			risk: {
				...m.risk,
				var95: m.risk.var95 ? { ...m.risk.var95 } : null,
			},
			benchmarks: m.benchmarks.map((b) => ({ ...b })),
			warnings: {
				unpricedSymbols: [...m.warnings.unpricedSymbols],
				ledgerInconsistencies: [...m.warnings.ledgerInconsistencies],
				noHistorySymbols: [...m.warnings.noHistorySymbols],
			},
		};
	}
}
