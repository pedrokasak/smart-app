import type { DidacticLevel, DidacticTerm } from './didactic.types';

/**
 * Glossário do Copiloto, uma definição por nível. Fonte única para as
 * respostas didáticas (e, depois, para a IA Insights e a trilha de
 * auditoria). Definições curtas, sem número inventado.
 */
export type TermKey =
	| 'concentracao'
	| 'diversificacao'
	| 'politica'
	| 'pp'
	| 'risco_score'
	| 'volatilidade'
	| 'beta'
	| 'correlacao'
	| 'provento'
	| 'dividend_yield'
	| 'yield_on_cost'
	| 'alocacao_alvo'
	| 'rebalancear'
	| 'preco_medio'
	| 'ganho_capital'
	| 'isencao_20k'
	| 'prejuizo_compensavel'
	| 'atribuicao'
	| 'retorno_real'
	| 'reais_de_hoje'
	| 'ir_regressivo'
	| 'isencao_lci_lca'
	| 'focus'
	| 'reinvestimento';

interface GlossaryEntry {
	label: string;
	byLevel: Record<DidacticLevel, string>;
}

export const GLOSSARY: Record<TermKey, GlossaryEntry> = {
	concentracao: {
		label: 'Concentração',
		byLevel: {
			iniciante:
				'Quanto do seu dinheiro está em um só investimento. Muita concentração deixa o resultado dependente de uma empresa.',
			intermediario:
				'Peso de um ativo (ou setor) no patrimônio. Quanto maior, mais o resultado depende dele.',
			avancado: 'Peso da posição no valor de mercado da carteira.',
		},
	},
	diversificacao: {
		label: 'Diversificação',
		byLevel: {
			iniciante:
				'Espalhar o dinheiro entre investimentos diferentes, para um problema em um não derrubar o resto.',
			intermediario:
				'Distribuição entre ativos, classes e setores que reduz a dependência de um único fator.',
			avancado:
				'Espalhamento entre ativos, classes e setores; a nota do Trackerr vai de 0 a 100.',
		},
	},
	politica: {
		label: 'Política de investimento',
		byLevel: {
			iniciante:
				'As regras que você definiu em Configurações, como o peso máximo de cada ativo.',
			intermediario:
				'Seus limites por ativo, setor e cripto, e os alvos por classe, definidos em Configurações.',
			avancado:
				'Limites e alvos definidos em Configurações, com histórico de versões.',
		},
	},
	pp: {
		label: 'p.p. (pontos percentuais)',
		byLevel: {
			iniciante:
				'A diferença entre dois percentuais. De 8% para 11% são 3 p.p. a mais.',
			intermediario:
				'Diferença absoluta entre dois percentuais (11% − 8% = 3 p.p.).',
			avancado: 'Diferença absoluta entre percentuais.',
		},
	},
	risco_score: {
		label: 'Score de risco',
		byLevel: {
			iniciante:
				'Uma nota de 0 a 100 que resume o risco da carteira. Quanto maior, mais arriscada.',
			intermediario:
				'Nota de 0 a 100 que soma concentração, diversificação, volatilidade e beta. Maior = mais risco.',
			avancado:
				'Score heurístico de 0 a 100 (concentração, diversificação, volatilidade e beta ponderados).',
		},
	},
	volatilidade: {
		label: 'Volatilidade',
		byLevel: {
			iniciante:
				'O quanto um investimento sobe e desce. Mais volátil, mais sustos no caminho.',
			intermediario:
				'Intensidade das oscilações do preço; mede o risco de curto prazo.',
			avancado: 'Desvio-padrão anualizado dos retornos.',
		},
	},
	beta: {
		label: 'Beta',
		byLevel: {
			iniciante:
				'Mostra se a carteira balança mais ou menos que a bolsa. Abaixo de 1, balança menos.',
			intermediario:
				'Sensibilidade ao índice: beta 0,8 tende a oscilar 80% do que o índice oscila.',
			avancado: 'Covariância com o índice dividida pela variância do índice.',
		},
	},
	correlacao: {
		label: 'Correlação',
		byLevel: {
			iniciante:
				'Se dois investimentos costumam subir e cair juntos. Juntos demais, quase não diversificam.',
			intermediario:
				'De −1 a 1: perto de 1, os ativos andam juntos e diversificam pouco entre si.',
			avancado: 'Correlação de Pearson dos retornos diários.',
		},
	},
	provento: {
		label: 'Provento',
		byLevel: {
			iniciante:
				'Dinheiro que a empresa ou o fundo paga a quem tem a ação ou a cota, como dividendos e rendimentos.',
			intermediario: 'Dividendos, JCP e rendimentos pagos por ações e FIIs.',
			avancado: 'Dividendos, JCP e rendimentos distribuídos.',
		},
	},
	dividend_yield: {
		label: 'Dividend yield',
		byLevel: {
			iniciante:
				'Quanto o investimento pagou em proventos no ano, em relação ao preço de hoje.',
			intermediario: 'Proventos dos últimos 12 meses ÷ preço atual.',
			avancado: 'Proventos de 12 meses sobre o valor de mercado.',
		},
	},
	yield_on_cost: {
		label: 'Yield sobre o custo',
		byLevel: {
			iniciante:
				'Quanto os proventos rendem sobre o que você pagou, e não sobre o preço de hoje.',
			intermediario: 'Proventos de 12 meses ÷ preço médio de compra.',
			avancado: 'Proventos de 12 meses sobre o custo de aquisição.',
		},
	},
	alocacao_alvo: {
		label: 'Alocação alvo',
		byLevel: {
			iniciante:
				'Quanto você quer ter em cada tipo de investimento, como "25% em renda fixa".',
			intermediario:
				'Percentual desejado por classe de ativo, definido na sua política.',
			avancado: 'Pesos-alvo por classe definidos na política.',
		},
	},
	rebalancear: {
		label: 'Rebalancear',
		byLevel: {
			iniciante:
				'Voltar a carteira para a divisão que você planejou, aportando mais no que ficou abaixo.',
			intermediario:
				'Ajustar os pesos de volta ao alvo, de preferência com aportes, sem vender.',
			avancado: 'Reconduzir os pesos ao alvo via aportes ou trocas.',
		},
	},
	preco_medio: {
		label: 'Preço médio',
		byLevel: {
			iniciante:
				'O valor médio que você pagou por cada ação, somando todas as compras.',
			intermediario:
				'Custo total das compras ÷ quantidade; base do lucro e do IR.',
			avancado: 'Custo médio ponderado de aquisição.',
		},
	},
	ganho_capital: {
		label: 'Ganho de capital',
		byLevel: {
			iniciante:
				'O lucro da venda: o quanto você vendeu acima do que pagou. É sobre ele que pode haver imposto.',
			intermediario: '(Preço de venda − preço médio) × quantidade; base do IR.',
			avancado: 'Resultado realizado sobre o custo médio.',
		},
	},
	isencao_20k: {
		label: 'Isenção de R$ 20 mil',
		byLevel: {
			iniciante:
				'Quem vende até R$ 20 mil em ações no mês não paga imposto sobre o lucro dessas vendas.',
			intermediario:
				'Vendas de ações de até R$ 20 mil no mês são isentas de IR (não vale para FIIs e day trade).',
			avancado:
				'Isenção sobre ganho em ações com alienações até R$ 20 mil no mês (exceto day trade e FII).',
		},
	},
	prejuizo_compensavel: {
		label: 'Prejuízo compensável',
		byLevel: {
			iniciante:
				'Um prejuízo de venda passada que pode ser descontado do lucro de uma venda futura, pagando menos imposto.',
			intermediario:
				'Perdas realizadas que abatem a base de cálculo de ganhos futuros.',
			avancado:
				'Perdas acumuladas compensáveis contra ganhos da mesma natureza.',
		},
	},
	atribuicao: {
		label: 'Atribuição de retorno',
		byLevel: {
			iniciante:
				'Quanto cada investimento ajudou ou atrapalhou o resultado do ano.',
			intermediario:
				'Contribuição de cada ativo ao retorno: peso × retorno do ativo.',
			avancado: 'Decomposição do retorno por contribuição de cada posição.',
		},
	},
	retorno_real: {
		label: 'Retorno real',
		byLevel: {
			iniciante:
				'Quanto o dinheiro cresce acima da inflação, depois do imposto. É o ganho que aumenta o que você consegue comprar.',
			intermediario:
				'Retorno líquido de IR descontada a inflação: (1 + líquido) ÷ (1 + IPCA) − 1.',
			avancado: '(1 + r_líq) / (1 + π) − 1, ao ano.',
		},
	},
	reais_de_hoje: {
		label: 'Reais de hoje',
		byLevel: {
			iniciante:
				'O valor futuro convertido para o poder de compra de hoje. R$ 11.000 daqui a 3 anos podem comprar o que R$ 9.800 compram hoje.',
			intermediario:
				'Valor final dividido pela inflação acumulada no prazo: o poder de compra em moeda de hoje.',
			avancado:
				'Valor final deflacionado pelo IPCA do cenário (valor presente real).',
		},
	},
	ir_regressivo: {
		label: 'IR regressivo',
		byLevel: {
			iniciante:
				'O imposto da renda fixa diminui quanto mais tempo o dinheiro fica aplicado: de 22,5% (até 6 meses) a 15% (mais de 2 anos), sempre sobre o ganho.',
			intermediario:
				'Alíquota sobre o ganho que cai com o prazo: 22,5%, 20%, 17,5% e 15% acima de 720 dias.',
			avancado:
				'Tabela regressiva: 22,5% / 20% / 17,5% / 15% (>720 dias), sobre o rendimento.',
		},
	},
	isencao_lci_lca: {
		label: 'Isenção de LCI e LCA',
		byLevel: {
			iniciante:
				'LCI e LCA não pagam imposto de renda para pessoa física: todo o ganho fica com você.',
			intermediario:
				'LCI, LCA, CRI e CRA são isentos de IR para pessoa física; por isso uma taxa menor pode render mais.',
			avancado:
				'Isenção de IR para PF (LCI, LCA, CRI, CRA); compare pela taxa tributada equivalente.',
		},
	},
	focus: {
		label: 'Projeção Focus',
		byLevel: {
			iniciante:
				'A inflação que os economistas do mercado esperam para os próximos anos, numa pesquisa semanal do Banco Central.',
			intermediario:
				'Mediana das projeções de IPCA das instituições na pesquisa Focus do BACEN, usada para simular o futuro.',
			avancado:
				'Mediana Focus (BACEN): 12 meses à frente e anos-calendário seguintes.',
		},
	},
	reinvestimento: {
		label: 'Reinvestimento',
		byLevel: {
			iniciante:
				'Usar o provento recebido para comprar mais cotas, que também passam a pagar proventos.',
			intermediario:
				'Aplicar os proventos no próprio ativo ou na carteira: os juros compostos fazem a renda crescer.',
			avancado:
				'Reinvestimento dos fluxos à taxa de dividend yield (composição).',
		},
	},
};

export function termsFor(
	keys: TermKey[],
	level: DidacticLevel
): DidacticTerm[] {
	return [...new Set(keys)].map((key) => ({
		term: GLOSSARY[key].label,
		definition: GLOSSARY[key].byLevel[level],
	}));
}
