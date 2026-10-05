import {
	TESOURO_FAMILY_ORDER,
	type TesouroFamily,
	type TesouroTitle,
} from './tesouro-title';

const FAMILY_LABEL: Record<TesouroFamily, string> = {
	SELIC: 'Tesouro Selic',
	PREFIXED: 'Tesouro Prefixado',
	IPCA_PLUS: 'Tesouro IPCA+',
};

export interface TesouroSelection {
	titles: TesouroTitle[];
	warnings: string[];
}

const byMaturity = (a: TesouroTitle, b: TesouroTitle) =>
	a.maturityDate.localeCompare(b.maturityDate);

/**
 * Um título por família: o de vencimento mais próximo do fim do prazo SEM
 * vencer antes dele. Vencer antes obrigaria a reaplicar a uma taxa que ninguém
 * conhece; vencer um pouco depois só pede venda no fim do prazo (e o papel
 * leva um aviso de marcação a mercado).
 *
 * Tesouro Selic é a exceção: não tem preço que oscile e rola na mesma taxa
 * (CDI + spread), então, sem título que alcance o prazo, vale o mais longo.
 */
export function pickTitlesForHorizon(
	titles: TesouroTitle[],
	horizonEnd: string
): TesouroSelection {
	const picked: TesouroTitle[] = [];
	const warnings: string[] = [];

	for (const family of TESOURO_FAMILY_ORDER) {
		const ofFamily = titles
			.filter((title) => title.family === family)
			.sort(byMaturity);
		if (ofFamily.length === 0) continue;

		const reaching = ofFamily.find((title) => title.maturityDate >= horizonEnd);
		if (reaching) {
			picked.push(reaching);
		} else if (family === 'SELIC') {
			picked.push(ofFamily[ofFamily.length - 1]);
		} else {
			warnings.push(
				`Nenhum ${FAMILY_LABEL[family]} vence depois do prazo simulado: fica fora da comparação.`
			);
		}
	}
	return { titles: picked, warnings };
}

/** Escolha manual: ids que saíram da oferta viram aviso, não erro. */
export function resolveTitlesById(
	titles: TesouroTitle[],
	ids: string[]
): TesouroSelection {
	const byId = new Map(titles.map((title) => [title.id, title]));
	const picked: TesouroTitle[] = [];
	const warnings: string[] = [];

	for (const id of new Set(ids)) {
		const title = byId.get(id);
		if (title) picked.push(title);
		else
			warnings.push(
				'Um título escolhido não está mais à venda e foi ignorado.'
			);
	}
	picked.sort((a, b) => {
		const family =
			TESOURO_FAMILY_ORDER.indexOf(a.family) -
			TESOURO_FAMILY_ORDER.indexOf(b.family);
		return family !== 0 ? family : byMaturity(a, b);
	});
	return { titles: picked, warnings };
}
