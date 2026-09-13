import { Injectable } from '@nestjs/common';
import { UnifiedIntelligenceFacade } from 'src/intelligence/application/unified-intelligence.facade';
import { PortfolioIntelligencePosition } from 'src/portfolio/intelligence/domain/portfolio-intelligence.types';
import { RagIngestItem } from 'src/ai/rag-ingestion/application/rag-ingestion.port';

/**
 * Transforma os fatos determinísticos da carteira em chunks de texto pro RAG
 * (TRA-84). O server é a fonte dos fatos (princípio das duas fontes, TRA-10);
 * aqui eles viram texto que o trackerr-ia vai embedar.
 *
 * Regra crítica (TRA-74): TODO número no texto é ARREDONDADO. Oscilação de
 * centavo entre um ciclo e outro mudaria o texto, mudaria o content_hash e
 * dispararia re-embed diário de tudo — anulando a economia da ingestão
 * incremental. Percentual vira inteiro, dinheiro vira reais cheios.
 */
@Injectable()
export class RagFactBuilderService {
	constructor(private readonly facade: UnifiedIntelligenceFacade) {}

	build(
		positions: PortfolioIntelligencePosition[],
		asOf: string
	): RagIngestItem[] {
		if (!positions.length) return [];

		const items: RagIngestItem[] = [];
		const summary = this.facade.getPortfolioSummary({ positions });
		const risk = this.facade.getPortfolioRiskAnalysis({ positions });

		// --- portfolio_position: um chunk por ativo ---------------------------
		for (const entry of summary.allocationByAsset || []) {
			const symbol = String(entry.key || '').toUpperCase();
			if (!symbol) continue;
			const pct = this.pct(entry.percentage);
			const position = positions.find(
				(p) => p.symbol?.toUpperCase() === symbol
			);
			const sector = position?.sector ? `Setor: ${position.sector}. ` : '';
			const assetType = position?.assetType
				? `Classe: ${position.assetType}.`
				: '';
			items.push({
				sourceType: 'portfolio_position',
				sourceId: `position:${symbol}`,
				content:
					`${symbol} representa ${pct}% da carteira. ${sector}${assetType}`.trim(),
				metadata: { symbol, sector: position?.sector ?? null },
				asOf,
			});
		}

		// --- portfolio_risk ---------------------------------------------------
		const flags = (risk.risk?.flags || [])
			.filter((f) => f.severity !== 'low')
			.slice(0, 4)
			.map((f) => f.message);
		const concentration = (risk.concentrationByAsset || [])
			.filter((c) => c.severity === 'high')
			.slice(0, 3)
			.map(
				(c) => `${String(c.key).toUpperCase()} (${this.pct(c.percentage)}%)`
			);
		const riskParts = [
			`Risco da carteira: nível ${risk.risk?.level ?? 'desconhecido'} (score ${this.round(
				risk.risk?.score ?? 0
			)}).`,
			concentration.length
				? `Concentração elevada em ${concentration.join(', ')}.`
				: '',
			flags.length ? `Sinais: ${flags.join('; ')}.` : '',
		].filter(Boolean);
		items.push({
			sourceType: 'portfolio_risk',
			sourceId: 'risk:summary',
			content: riskParts.join(' '),
			metadata: { level: risk.risk?.level ?? null },
			asOf,
		});

		// --- portfolio_performance -------------------------------------------
		const div = summary.diversification;
		items.push({
			sourceType: 'portfolio_performance',
			sourceId: 'performance:summary',
			content:
				`Patrimônio total da carteira: R$ ${this.money(summary.totalValue)}. ` +
				`${summary.positionsCount} ativos. ` +
				`Diversificação: ${div?.status ?? 'desconhecida'} ` +
				`(score ${this.round(div?.score ?? 0)} de ${this.round(div?.maxScore ?? 0)}).`,
			metadata: { positionsCount: summary.positionsCount },
			asOf,
		});

		// --- portfolio_dividend ----------------------------------------------
		const dp = summary.dividendProjection;
		if (dp) {
			items.push({
				sourceType: 'portfolio_dividend',
				sourceId: 'dividend:summary',
				content:
					`Projeção de dividendos: R$ ${this.money(dp.projectedAnnualIncome)}/ano ` +
					`(R$ ${this.money(dp.projectedMonthlyIncome)}/mês), ` +
					`yield de ${this.pct(dp.projectedYieldOnPortfolioPct)}% sobre a carteira.`,
				metadata: null as never,
				asOf,
			});
		}

		return items.filter((item) => item.content && item.content.trim());
	}

	// Percentual pode vir como fração (0.22) ou como já-percentual (22).
	// Normaliza pra inteiro. Arredondar é o ponto (TRA-74).
	private pct(value: number | undefined): number {
		const n = Number(value || 0);
		const asPercent = n > 0 && n <= 1 ? n * 100 : n;
		return Math.round(asPercent);
	}

	private money(value: number | undefined): string {
		return Math.round(Number(value || 0)).toLocaleString('pt-BR');
	}

	private round(value: number | undefined): number {
		return Math.round(Number(value || 0));
	}
}
