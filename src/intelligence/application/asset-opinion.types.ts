export interface AssetOpinionOutput {
	symbol: string;
	/** 1-2 frases com classificação implícita, sem verbo de recomendação. */
	summary: string;
	/** Principal driver positivo, já em português, pronto para exibir. */
	strength: string;
	/** Principal driver de atenção. Nunca "venda"/"evite" — é um fato sobre o ativo, não uma instrução. */
	attention: string;
	/** Até 3 rótulos curtos: score e os pilares mais fortes. */
	tags: string[];
	scoreOverall: number;
	status: 'ok' | 'degraded';
}
