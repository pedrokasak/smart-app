export type PortfolioErrorRadarAlertType =
	| 'concentration'
	| 'diversification'
	| 'volatility'
	| 'other';

export interface PortfolioErrorRadarAlert {
	code: string;
	type: PortfolioErrorRadarAlertType;
	severity: 'low' | 'medium' | 'high';
	message: string;
	/** Presente só quando o alerta aponta pra um ativo específico. */
	symbol?: string;
}

export interface PortfolioErrorRadarOutput {
	modelVersion: 'portfolio_error_radar_v1';
	status: 'ok' | 'insufficient_data';
	riskLevel: 'low' | 'medium' | 'high' | null;
	alerts: PortfolioErrorRadarAlert[];
	positionsCount: number;
}
