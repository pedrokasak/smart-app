import { Injectable } from '@nestjs/common';
import { PortfolioIntelligenceService } from 'src/portfolio/intelligence/application/portfolio-intelligence.service';
import { PortfolioIntelligencePosition } from 'src/portfolio/intelligence/domain/portfolio-intelligence.types';
import {
	PortfolioErrorRadarAlert,
	PortfolioErrorRadarAlertType,
	PortfolioErrorRadarOutput,
} from 'src/intelligence/application/portfolio-error-radar.types';

const CONCENTRATION_CODES = new Set([
	'ASSET_CONCENTRATION_HIGH',
	'ASSET_CONCENTRATION_MEDIUM',
	'CLASS_CONCENTRATION_HIGH',
	'SECTOR_CONCENTRATION_HIGH',
	'SECTOR_CONCENTRATION_MEDIUM',
	'UNKNOWN_SECTOR_EXPOSURE_HIGH',
]);
const DIVERSIFICATION_CODES = new Set([
	'DIVERSIFICATION_POOR',
	'DIVERSIFICATION_MODERATE',
]);
const VOLATILITY_CODES = new Set([
	'VOLATILITY_HIGH',
	'VOLATILITY_MEDIUM',
	'BETA_HIGH',
]);

type TopEntries = {
	assetSymbol?: string;
	assetPct?: number;
	classKey?: string;
	classPct?: number;
	sectorKey?: string;
	sectorPct?: number;
};

/**
 * "Radar Anti-Erro" — expoe os flags que PortfolioIntelligenceEngine.computeRisk
 * ja calcula (concentracao de ativo/classe/setor, diversificacao, exposicao
 * setorial desconhecida, volatilidade, beta) como alertas preventivos, com o
 * percentual real que disparou o alerta — nunca so a categoria.
 *
 * Correlacao entre ativos, prevista no escopo original da feature, NAO esta
 * implementada aqui: exigiria serie historica de preco por ativo, que
 * MarketDataProviderPort nao expoe hoje. Adicionar isso e trabalho novo de
 * infraestrutura de dado, nao mapeamento — deliberadamente fora desta
 * entrega para nao fabricar um numero de correlacao sem base real.
 */
@Injectable()
export class PortfolioErrorRadarService {
	constructor(
		private readonly portfolioIntelligenceService: PortfolioIntelligenceService
	) {}

	detect(positions: PortfolioIntelligencePosition[]): PortfolioErrorRadarOutput {
		const safePositions = positions || [];

		if (safePositions.length === 0) {
			return {
				modelVersion: 'portfolio_error_radar_v1',
				status: 'insufficient_data',
				riskLevel: null,
				alerts: [],
				positionsCount: 0,
			};
		}

		const analysis =
			this.portfolioIntelligenceService.analyzePositions(safePositions);
		const { risk } = analysis.estimates;
		const { facts } = analysis;

		const top: TopEntries = {
			assetSymbol: facts.concentrationByAsset[0]?.key,
			assetPct: facts.concentrationByAsset[0]?.percentage,
			classKey: facts.allocationByClass[0]?.key,
			classPct: facts.allocationByClass[0]?.percentage,
			sectorKey: facts.concentrationBySector[0]?.key,
			sectorPct: facts.concentrationBySector[0]?.percentage,
		};

		const alerts = risk.flags.map((flag) =>
			this.toAlert(flag.code, flag.severity, top)
		);

		return {
			modelVersion: 'portfolio_error_radar_v1',
			status: 'ok',
			riskLevel: risk.level,
			alerts,
			positionsCount: safePositions.length,
		};
	}

	private toAlert(
		code: string,
		severity: 'low' | 'medium' | 'high',
		top: TopEntries
	): PortfolioErrorRadarAlert {
		return {
			code,
			type: this.resolveType(code),
			severity,
			message: this.resolveMessage(code, top),
			symbol: code.startsWith('ASSET_CONCENTRATION_')
				? top.assetSymbol
				: undefined,
		};
	}

	private resolveType(code: string): PortfolioErrorRadarAlertType {
		if (CONCENTRATION_CODES.has(code)) return 'concentration';
		if (DIVERSIFICATION_CODES.has(code)) return 'diversification';
		if (VOLATILITY_CODES.has(code)) return 'volatility';
		return 'other';
	}

	private resolveMessage(code: string, top: TopEntries): string {
		const pct = (value: number | undefined) =>
			typeof value === 'number' ? value.toFixed(1) : null;

		switch (code) {
			case 'ASSET_CONCENTRATION_HIGH':
			case 'ASSET_CONCENTRATION_MEDIUM': {
				const level = code.endsWith('HIGH') ? 'alta' : 'moderada';
				const p = pct(top.assetPct);
				return p
					? `${top.assetSymbol} representa ${p}% da carteira — concentração ${level}.`
					: `${top.assetSymbol || 'Um ativo'} tem concentração ${level} na carteira.`;
			}
			case 'CLASS_CONCENTRATION_HIGH': {
				const p = pct(top.classPct);
				return p
					? `${top.classKey} representa ${p}% da carteira, acima do limite recomendado.`
					: 'Uma classe de ativo concentra uma parcela alta da carteira, acima do limite recomendado.';
			}
			case 'SECTOR_CONCENTRATION_HIGH':
			case 'SECTOR_CONCENTRATION_MEDIUM': {
				const level = code.endsWith('HIGH') ? 'alta' : 'moderada';
				const p = pct(top.sectorPct);
				return p
					? `Setor ${top.sectorKey} representa ${p}% da carteira — concentração ${level}.`
					: `Um setor tem concentração ${level} na carteira.`;
			}
			case 'UNKNOWN_SECTOR_EXPOSURE_HIGH':
				return 'Parte relevante da carteira não tem setor identificado, o que limita a precisão da análise de concentração.';
			case 'DIVERSIFICATION_POOR':
				return 'A diversificação da carteira está baixa.';
			case 'DIVERSIFICATION_MODERATE':
				return 'A diversificação da carteira é moderada.';
			case 'VOLATILITY_HIGH':
				return 'A volatilidade ponderada da carteira indica risco de variação alto no curto prazo.';
			case 'VOLATILITY_MEDIUM':
				return 'A volatilidade ponderada da carteira indica risco de variação moderado no curto prazo.';
			case 'BETA_HIGH':
				return 'O beta da carteira sugere sensibilidade acima da média em relação ao mercado.';
			default:
				return 'Sinal de risco identificado na carteira.';
		}
	}
}
