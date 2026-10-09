export type PortfolioErrorRadarAlertType =
	| 'concentration'
	| 'diversification'
	| 'volatility'
	| 'other';

export type RadarMetricUnit = 'pct' | 'score' | 'ratio';

/**
 * O número que disparou o alerta, contra qual limite e sobre qual base. É o
 * que transforma "concentração alta" em "PETR4 em 10,9%, sua política diz 8%".
 */
export interface RadarEvidence {
	metric: { label: string; value: number; unit: RadarMetricUnit };
	/**
	 * `policy`: limite que o próprio usuário definiu em Configurações.
	 * `model`: limiar fixo do motor de risco (heuristic_v1).
	 */
	limit: {
		label: string;
		value: number;
		unit: RadarMetricUnit;
		source: 'policy' | 'model';
	} | null;
	/** Quanto passou do limite, na unidade da métrica; `null` sem limite. */
	excess: number | null;
	/** De onde vem o número, em português, para a tela de cálculo. */
	basis: string;
	/** Fórmula ou regra aplicada, em português. */
	rule: string;
}

/** Ação concreta para voltar ao limite da política, com o custo estimado. */
export interface RadarAction {
	kind: 'reduce_position';
	symbol: string;
	/** Quantidade inteira a vender (fração só em cripto e fundos). */
	quantity: number;
	/** Valor bruto da venda, em reais. */
	amount: number;
	/** Peso da posição depois da venda. */
	targetPct: number;
	/** IR estimado; `null` quando falta preço médio para calcular. */
	estimatedTax: number | null;
	/** "isento", "tributavel"…, como o motor fiscal classifica. */
	taxClassification: string | null;
	/** O que a estimativa NÃO considera (prejuízo acumulado, vendas do mês). */
	assumptions: string[];
}

export interface PortfolioErrorRadarAlert {
	code: string;
	type: PortfolioErrorRadarAlertType;
	severity: 'low' | 'medium' | 'high';
	message: string;
	/** Presente só quando o alerta aponta pra um ativo específico. */
	symbol?: string;
	/** Presente no `GET /ai/error-radar` (com o contexto do usuário). */
	evidence?: RadarEvidence;
	action?: RadarAction;
}

export interface PortfolioErrorRadarOutput {
	modelVersion: 'portfolio_error_radar_v1';
	status: 'ok' | 'insufficient_data';
	riskLevel: 'low' | 'medium' | 'high' | null;
	alerts: PortfolioErrorRadarAlert[];
	positionsCount: number;
	/** Quando houver: data da cotação mais recente usada nos pesos (ISO). */
	pricesAsOf?: string | null;
}
