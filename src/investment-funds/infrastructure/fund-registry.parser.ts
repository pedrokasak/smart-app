import { normalizeCnpj } from '../domain/cnpj';
import type { FundSubclass, InvestmentFundClass } from '../domain/fund-class';

/**
 * Registro de fundos e classes da CVM (`FI/CAD/DADOS/registro_fundo_classe.zip`,
 * RCVM 175). Os CSVs vêm em ISO-8859-1, separados por `;` e SEM aspas de CSV:
 * aspas aparecem dentro do nome (`SUBCLASSE "A" DA CLASSE…`) e fazem parte
 * dele. Por isso o split é por `;`, e não um parser de CSV com aspas.
 *
 * As colunas são achadas pelo nome; faltando uma das que o domínio usa, a
 * leitura para (a CVM mudou o arquivo e é melhor manter o cadastro de ontem).
 */

const CLASS_COLUMNS = [
	'ID_Registro_Classe',
	'CNPJ_Classe',
	'Tipo_Classe',
	'Denominacao_Social',
	'Situacao',
	'Classificacao',
	'Forma_Condominio',
	'Exclusivo',
	'Publico_Alvo',
] as const;

const SUBCLASS_COLUMNS = [
	'ID_Registro_Classe',
	'ID_Subclasse',
	'Denominacao_Social',
	'Situacao',
] as const;

/** Só FIF publica cota diária no Informe Diário. Inclui "FIF (FAPI)". */
const DAILY_QUOTE_CLASS_TYPE = /^Classes de Cotas de Fundos FIF\b/;
const CANCELLED = 'Cancelado';

export class FundRegistrySchemaError extends Error {
	constructor(file: string, missing: string[]) {
		super(`Registro da CVM (${file}) sem as colunas: ${missing.join(', ')}`);
		this.name = 'FundRegistrySchemaError';
	}
}

type Row<T extends readonly string[]> = Record<T[number], string>;

function* readRows<T extends readonly string[]>(
	text: string,
	columns: T,
	file: string
): Generator<Row<T>> {
	const lines = text.split(/\r?\n/);
	const header = (lines[0] ?? '').replace(/^﻿/, '').split(';');
	const missing = columns.filter((column) => !header.includes(column));
	if (missing.length) throw new FundRegistrySchemaError(file, missing);

	const indexes = columns.map((column) => header.indexOf(column));
	for (const line of lines.slice(1)) {
		if (!line) continue;
		const fields = line.split(';');
		if (fields.length !== header.length) continue;
		yield Object.fromEntries(
			columns.map((column, i) => [column, fields[indexes[i]].trim()])
		) as Row<T>;
	}
}

export interface FundRegistryTexts {
	classes: string;
	subclasses: string | null;
}

export function parseFundRegistry({
	classes,
	subclasses,
}: FundRegistryTexts): InvestmentFundClass[] {
	const subclassesByClass = new Map<string, FundSubclass[]>();
	if (subclasses) {
		for (const row of readRows(
			subclasses,
			SUBCLASS_COLUMNS,
			'registro_subclasse.csv'
		)) {
			if (!row.ID_Subclasse || row.Situacao === CANCELLED) continue;
			const list = subclassesByClass.get(row.ID_Registro_Classe) ?? [];
			list.push({ id: row.ID_Subclasse, name: row.Denominacao_Social });
			subclassesByClass.set(row.ID_Registro_Classe, list);
		}
	}

	const byCnpj = new Map<string, InvestmentFundClass>();
	for (const row of readRows(classes, CLASS_COLUMNS, 'registro_classe.csv')) {
		if (!DAILY_QUOTE_CLASS_TYPE.test(row.Tipo_Classe)) continue;
		if (row.Situacao === CANCELLED) continue;
		const cnpj = normalizeCnpj(row.CNPJ_Classe);
		if (!cnpj || !row.Denominacao_Social) continue;

		byCnpj.set(cnpj, {
			cnpj,
			name: row.Denominacao_Social,
			classification: row.Classificacao || null,
			status: row.Situacao,
			condominium: row.Forma_Condominio || null,
			exclusive: row.Exclusivo === 'S',
			targetAudience: row.Publico_Alvo || null,
			subclasses: subclassesByClass.get(row.ID_Registro_Classe) ?? [],
		});
	}
	return [...byCnpj.values()];
}
