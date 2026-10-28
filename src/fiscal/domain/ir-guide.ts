import { IrGuideStepDto } from 'src/fiscal/dto/ir-report-response.dto';
import {
	assetsAndRightsCodeCaveat,
	assetsAndRightsTableFor,
	formatAssetsAndRightsCode,
} from 'src/fiscal/domain/assets-and-rights-codes';

/**
 * Textos de preenchimento da declaração. Nenhum código de bem fica escrito
 * aqui: todos vêm de `assets-and-rights-codes.ts`, para o guia do resumo
 * fiscal e o do relatório de IR não voltarem a discordar.
 */

const ETF_LINE =
	'ETFs e outros fundos: escolha na lista do programa o código do tipo de fundo (por exemplo, fundo de índice). Este guia não fixa o código de ETF porque ele ainda não foi confirmado na tabela oficial.';

/** A declaração do ano-calendário `year` é entregue no exercício seguinte. */
const exerciseOf = (year: number) => year + 1;

/** Frases com o código de ações e de FII, ou vazio se não há tabela. */
function codeSentences(year: number): { stock: string; fii: string } {
	const table = assetsAndRightsTableFor(exerciseOf(year));
	if (!table) {
		return {
			stock: 'Para ações, escolha o código na lista do programa da Receita.',
			fii: 'Para FIIs, escolha o código na lista do programa da Receita.',
		};
	}
	const { stock, fii } = table.codes;
	return {
		stock: `Para ações, use ${formatAssetsAndRightsCode(stock)}${assetsAndRightsCodeCaveat(stock)}.`,
		fii: `Para FIIs, use ${formatAssetsAndRightsCode(fii)}${assetsAndRightsCodeCaveat(fii)}.`,
	};
}

/** Guia curto do `GET /fiscal/summary`. */
export function buildSummaryGuide(year: number): string[] {
	const { stock, fii } = codeSentences(year);
	const steps = [
		'Abra o programa da Receita Federal.',
		'Vá em Bens e Direitos.',
		stock,
		fii,
		ETF_LINE,
		'Informe posição em 31/12 e custo de aquisição.',
		'Lance dividendos e JCP na ficha Rendimentos.',
	];
	return steps.map((step, index) => `Passo ${index + 1}: ${step}`);
}

/** Guia do relatório anual de IR (`GET /fiscal/ir-report` e o PDF). */
export function buildIrGuideSteps(year: number): IrGuideStepDto[] {
	const table = assetsAndRightsTableFor(exerciseOf(year));
	const { stock, fii } = codeSentences(year);
	const stockTitle = table
		? `1) Bens e Direitos (ações) - ${formatAssetsAndRightsCode(table.codes.stock)}`
		: '1) Bens e Direitos (ações)';

	return [
		{
			title: stockTitle,
			details:
				'Informe cada ativo com posição em 31/12/' +
				year +
				' pelo custo de aquisição (não pelo preço de mercado). Use os valores da seção "Posição em 31/12". ' +
				`${stock} ${fii} ${ETF_LINE}`,
		},
		{
			title: '2) Rendimentos Isentos e Não Tributáveis (dividendos)',
			details:
				'Lance o total anual de dividendos recebido por ativo. Use a seção "Dividendos" como base e valide com informes da corretora.',
		},
		{
			title: '3) Rendimentos Sujeitos à Tributação Exclusiva/Definitiva (JCP)',
			details:
				'Com os dados atuais, o sistema preenche JCP com zero por padrão. Se você teve JCP, complemente manualmente com o informe oficial.',
		},
		{
			title: '4) Operações Comuns/Day Trade (Renda Variável)',
			details:
				'Use a seção "Operações tributáveis" para apoiar a apuração mensal de lucro/prejuízo. Prejuízos podem ser compensados em meses futuros.',
		},
		{
			title: '5) Criptoativos - Bens e Direitos e GCAP/IRPF',
			details:
				'Para cripto com saldo em 31/12/' +
				year +
				', preencha em Bens e Direitos conforme natureza do ativo. Use também a seção "Cripto" para apoiar ganho/perda em vendas.',
		},
		{
			title: '6) Conferência final',
			details:
				'Valide tudo com notas de corretagem, extratos e informes de rendimento. Este relatório é de apoio e não substitui conferência contábil.',
		},
	];
}
