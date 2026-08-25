/**
 * Diagnóstico do estado dos dados de uma carteira.
 *
 * Existe porque as correções de importação (PRs #114–#117) pararam as
 * escritas erradas mas não reescrevem o que já está gravado. Sem uma
 * forma de olhar o banco, a única verificação possível era abrir a tela e
 * julgar no olho — que foi exatamente como os bugs passaram despercebidos.
 *
 * É só leitura: aponta o que está torto e por quê, sem alterar nada.
 */

export type DividendEntry = { date?: unknown; value?: unknown };

export type HealthAsset = {
	symbol?: string;
	avgPrice?: number | null;
	price?: number | null;
	quantity?: number | null;
	source?: string;
	dividendHistory?: DividendEntry[];
};

export type DataHealthFinding = {
	code:
		| 'custo-igual-a-cotacao'
		| 'sem-custo-de-aquisicao'
		| 'proventos-em-data-unica'
		| 'historico-insuficiente'
		| 'historico-constante';
	severity: 'alta' | 'media' | 'baixa';
	symbols?: string[];
	count?: number;
	detail: string;
	remedy: string;
};

export type DataHealthReport = {
	healthy: boolean;
	assetsChecked: number;
	findings: DataHealthFinding[];
};

const isSameNumber = (a: unknown, b: unknown): boolean => {
	const left = Number(a);
	const right = Number(b);
	if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
	return Math.abs(left - right) < 1e-9;
};

const monthKey = (value: unknown): string | null => {
	const date = new Date(value as any);
	return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 7);
};

export function buildDataHealthReport(
	assets: HealthAsset[],
	history: Array<{ totalValue?: number }> = []
): DataHealthReport {
	const findings: DataHealthFinding[] = [];

	// Assinatura da gravação do importador antigo: custo exatamente igual à
	// cotação, o que zera o P&L por construção.
	const corrupted = assets
		.filter(
			(asset) =>
				asset.source === 'b3' &&
				Number(asset.avgPrice) > 0 &&
				isSameNumber(asset.avgPrice, asset.price)
		)
		.map((asset) => String(asset.symbol || '?'));

	if (corrupted.length) {
		findings.push({
			code: 'custo-igual-a-cotacao',
			severity: 'alta',
			symbols: corrupted,
			count: corrupted.length,
			detail:
				'O custo de aquisição gravado é idêntico à cotação atual, o que faz o P&L ser exatamente zero. Foi o importador consolidado antigo que gravou a cotação de fechamento como se fosse custo.',
			remedy:
				'Importe o extrato de negociação da B3: ele traz o preço de cada compra e o custo passa a ser calculado a partir dele.',
		});
	}

	const semCusto = assets
		.filter(
			(asset) =>
				Number(asset.quantity) > 0 &&
				!(Number(asset.avgPrice) > 0) &&
				!corrupted.includes(String(asset.symbol || '?'))
		)
		.map((asset) => String(asset.symbol || '?'));

	if (semCusto.length) {
		findings.push({
			code: 'sem-custo-de-aquisicao',
			severity: 'media',
			symbols: semCusto,
			count: semCusto.length,
			detail:
				'Sem custo de aquisição não há lucro a calcular, então o P&L aparece como indisponível. O relatório consolidado não traz quanto foi pago — só a cotação.',
			remedy:
				'Importe o extrato de negociação da B3 para estes papéis, ou informe o preço médio manualmente.',
		});
	}

	// Proventos empilhados num mês só: assinatura do provento carimbado com
	// a data do upload em vez da data real de pagamento.
	const empilhados = assets
		.filter((asset) => {
			const entries = asset.dividendHistory ?? [];
			if (entries.length < 3) return false;
			const meses = new Set(
				entries.map((entry) => monthKey(entry.date)).filter(Boolean)
			);
			return meses.size === 1;
		})
		.map((asset) => String(asset.symbol || '?'));

	if (empilhados.length) {
		findings.push({
			code: 'proventos-em-data-unica',
			severity: 'alta',
			symbols: empilhados,
			count: empilhados.length,
			detail:
				'Todos os proventos destes papéis estão no mesmo mês. O relatório consolidado não informa data de pagamento, então o importador antigo carimbava tudo com a data do upload.',
			remedy:
				'Importe o extrato de movimentação da B3: ele tem a data de cada pagamento e substitui o período que cobre, sem duplicar valores.',
		});
	}

	const valores = history
		.map((row) => Number(row?.totalValue))
		.filter((value) => Number.isFinite(value));

	if (valores.length < 2) {
		findings.push({
			code: 'historico-insuficiente',
			severity: 'baixa',
			count: valores.length,
			detail:
				'Há menos de dois pontos de histórico, então o gráfico não tem como desenhar variação em nenhum período.',
			remedy:
				'O histórico acumula um ponto por dia automaticamente. Os botões de período passam a diferir conforme os dias passam.',
		});
	} else if (Math.max(...valores) - Math.min(...valores) < 1e-9) {
		findings.push({
			code: 'historico-constante',
			severity: 'media',
			count: valores.length,
			detail:
				'Todos os pontos do histórico têm exatamente o mesmo valor, então a linha fica reta e todos os períodos mostram a mesma coisa. As cotações não estão sendo atualizadas, então o valor da carteira não muda de um dia para o outro.',
			remedy:
				'Depende de ligar as fontes de cotação de mercado. Enquanto isso, a linha reta reflete a falta de dado, não um erro de cálculo.',
		});
	}

	return {
		healthy: findings.length === 0,
		assetsChecked: assets.length,
		findings,
	};
}
