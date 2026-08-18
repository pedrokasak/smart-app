export type PortfolioScoreDimensionKey = 'diversification' | 'risk';

export interface PortfolioScoreDimension {
	key: PortfolioScoreDimensionKey;
	/**
	 * Sempre normalizado para "maior = melhor", inclusive risco. O engine
	 * produz risco na direcao oposta (score alto = mais arriscado), entao a
	 * inversao acontece aqui, uma vez, em vez de espalhada pelos consumidores.
	 */
	score: number;
	weight: number;
}

export interface PortfolioScoreFlag {
	code: string;
	severity: 'low' | 'medium' | 'high';
	message: string;
}

export interface PortfolioScoreOutput {
	modelVersion: 'portfolio_score_v1';
	/**
	 * null quando nao ha posicao suficiente para calcular. Nunca 0: uma
	 * carteira vazia nao tem score ruim, tem score inexistente, e 0 seria
	 * lido como "pessimo" tanto pela UI quanto por quem consome a API.
	 */
	overall: number | null;
	status: 'ok' | 'insufficient_data';
	dimensions: PortfolioScoreDimension[];
	diversificationStatus: 'poor' | 'moderate' | 'good' | 'excellent' | null;
	riskLevel: 'low' | 'medium' | 'high' | null;
	flags: PortfolioScoreFlag[];
	positionsCount: number;
}
