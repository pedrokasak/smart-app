/**
 * Códigos da ficha "Bens e Direitos" do programa do IRPF.
 *
 * O usuário copia estes códigos para o programa da Receita, então um código
 * errado vira bem no grupo errado na declaração. Eles estavam escritos à mão
 * em três lugares e discordavam (ações no "Código 31" de uma tabela antiga,
 * FII no 07/03 da atual). Esta é a única fonte.
 *
 * A Receita muda a tabela de tempos em tempos (a última reorganização foi no
 * exercício 2022), por isso cada tabela vale a partir de um exercício e traz
 * a data da última conferência. Quando sair a do exercício seguinte, entra uma
 * nova tabela aqui; as antigas ficam para os relatórios de anos passados.
 *
 * `status` diz o quanto confiar:
 *  - `official`: lido na tabela do programa ou nas instruções da Receita.
 *  - `secondary`: só em matérias sobre a mudança. O guia avisa o usuário para
 *    conferir na lista do programa.
 *
 * Ficam de fora, de propósito, os tipos cujo código as fontes disputam: ETF
 * (apareceu como 07-06, 74 e 49 em portais diferentes) e criptoativos. O guia
 * manda o usuário escolher na lista do programa em vez de arriscar um número.
 */
export type CodedAssetKind = 'stock' | 'fii';

export type AssetsAndRightsCodeStatus = 'official' | 'secondary';

export interface AssetsAndRightsCode {
	group: string;
	code: string;
	description: string;
	status: AssetsAndRightsCodeStatus;
	source: string;
}

export interface AssetsAndRightsTable {
	/** Primeiro exercício (ano da declaração) em que esta tabela vale. */
	sinceExercise: number;
	/** Última vez que a tabela foi conferida, AAAA-MM-DD. */
	checkedAt: string;
	codes: Readonly<Record<CodedAssetKind, AssetsAndRightsCode>>;
}

const SECONDARY_SOURCE =
	'Matérias sobre a reorganização da ficha no IRPF 2022 (COAD, Safra, InvestNews). Conferir na tabela do programa da Receita.';

export const ASSETS_AND_RIGHTS_TABLES: ReadonlyArray<AssetsAndRightsTable> = [
	{
		sinceExercise: 2022,
		checkedAt: '2026-10-28',
		codes: {
			stock: {
				group: '03',
				code: '01',
				description: 'Ações (inclusive as listadas em bolsa)',
				status: 'secondary',
				source: SECONDARY_SOURCE,
			},
			fii: {
				group: '07',
				code: '03',
				description: 'Fundos de Investimento Imobiliário (FII)',
				status: 'secondary',
				source: SECONDARY_SOURCE,
			},
		},
	},
];

/**
 * A tabela do exercício: a mais recente que já valia nele. Exercício sem
 * tabela publicada ainda (como o seguinte ao último conferido) usa a vigente,
 * e `checkedAt` mostra há quanto tempo ela foi conferida. Antes da primeira
 * tabela conhecida não há o que devolver.
 */
export function assetsAndRightsTableFor(
	exercise: number
): AssetsAndRightsTable | null {
	return (
		[...ASSETS_AND_RIGHTS_TABLES]
			.sort((a, b) => b.sinceExercise - a.sinceExercise)
			.find((table) => table.sinceExercise <= exercise) ?? null
	);
}

export function formatAssetsAndRightsCode(code: AssetsAndRightsCode): string {
	return `Grupo ${code.group}, Código ${code.code}`;
}

/** Aviso para o usuário quando o código não vem de fonte oficial. */
export function assetsAndRightsCodeCaveat(code: AssetsAndRightsCode): string {
	return code.status === 'official'
		? ''
		: ' (confira o código na lista do programa da Receita)';
}
