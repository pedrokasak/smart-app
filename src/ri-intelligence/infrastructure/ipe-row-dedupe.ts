/**
 * Uma linha do dataset IPE da CVM por documento (TRA-277).
 *
 * O IPE lista cada ENTREGA, e um mesmo documento pode ter varias:
 *
 *  - Reapresentacao: a empresa reenvia o documento (`Versao` 2, 3...) com
 *    outro link. As versoes antigas continuam no dataset.
 *  - Idioma: o release sai em portugues e em ingles (`Earnings Release versão
 *    Português` e `Earnings Release English version`), mesma data, mesma
 *    categoria, links diferentes.
 *
 * A tela mostrava as duas como o mesmo "Release · 2T26", lado a lado. Aqui
 * fica a versao mais recente de cada documento e, quando existe a versao em
 * portugues, a em ingles sai. Documento que so existe em ingles (ex.: DFs em
 * BR GAAP traduzidas, cuja versao em portugues vem pelo ITR e nao pelo IPE)
 * continua na lista.
 */
export type IpeRow = Record<string, string>;

const ENGLISH = /\benglish\b|\bingl\S{1,3}s\b/i;

const field = (row: IpeRow, name: string): string =>
	String(row[name] || '')
		.trim()
		.toLowerCase();

/** O mesmo documento em qualquer versao: tudo menos versao, entrega e link. */
const documentKey = (row: IpeRow): string =>
	['Categoria', 'Tipo', 'Especie', 'Assunto', 'Data_Referencia']
		.map((name) => field(row, name))
		.join('|');

/** Documentos irmaos que diferem so no idioma do assunto. */
const languageGroupKey = (row: IpeRow): string =>
	['Categoria', 'Tipo', 'Especie', 'Data_Referencia']
		.map((name) => field(row, name))
		.join('|');

const isEnglish = (row: IpeRow): boolean =>
	ENGLISH.test(`${row.Especie || ''} ${row.Assunto || ''}`);

const versionOf = (row: IpeRow): number => {
	const version = Number(String(row.Versao || '').trim());
	return Number.isFinite(version) ? version : 0;
};

function isNewer(candidate: IpeRow, current: IpeRow): boolean {
	const byVersion = versionOf(candidate) - versionOf(current);
	if (byVersion !== 0) return byVersion > 0;
	return field(candidate, 'Data_Entrega') > field(current, 'Data_Entrega');
}

export function latestVersionPerDocument(rows: IpeRow[]): IpeRow[] {
	const latest = new Map<string, IpeRow>();
	for (const row of rows) {
		const key = documentKey(row);
		const current = latest.get(key);
		if (!current || isNewer(row, current)) latest.set(key, row);
	}
	const kept = rows.filter((row) => latest.get(documentKey(row)) === row);
	return dropReplacedWithNewSubject(kept);
}

/**
 * Reapresentacao que mudou o assunto (ex.: v2 acrescenta "Eleicao de
 * Diretor(es)") nao cai na chave exata. Ela substitui a versao anterior
 * quando, no mesmo grupo (categoria, tipo, especie, data de referencia), ha
 * UMA so linha de versao menor: com duas ou mais, nao da para saber qual foi
 * reapresentada, e as duas ficam.
 */
function dropReplacedWithNewSubject(rows: IpeRow[]): IpeRow[] {
	const replaced = new Set<IpeRow>();
	for (const row of rows) {
		if (versionOf(row) <= 1) continue;
		const older = rows.filter(
			(other) =>
				other !== row &&
				languageGroupKey(other) === languageGroupKey(row) &&
				versionOf(other) < versionOf(row)
		);
		if (older.length === 1) replaced.add(older[0]);
	}
	return rows.filter((row) => !replaced.has(row));
}

export function dropEnglishWhenPortugueseExists(rows: IpeRow[]): IpeRow[] {
	const groupsWithPortuguese = new Set(
		rows.filter((row) => !isEnglish(row)).map(languageGroupKey)
	);
	return rows.filter(
		(row) => !isEnglish(row) || !groupsWithPortuguese.has(languageGroupKey(row))
	);
}

export function onePerDocument(rows: IpeRow[]): IpeRow[] {
	return dropEnglishWhenPortugueseExists(latestVersionPerDocument(rows));
}
