/** Números em pt-BR para o texto didático: vírgula decimal, nada de chave interna. */

export const pct = (value: number, digits = 1) =>
	`${Number(value).toLocaleString('pt-BR', {
		minimumFractionDigits: 0,
		maximumFractionDigits: digits,
	})}%`;

export const pp = (value: number, digits = 1) =>
	`${Math.abs(Number(value)).toLocaleString('pt-BR', {
		minimumFractionDigits: 0,
		maximumFractionDigits: digits,
	})} p.p.`;

export const money = (value: number) =>
	new Intl.NumberFormat('pt-BR', {
		style: 'currency',
		currency: 'BRL',
		maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
	}).format(Number(value) || 0);

export const num = (value: number, digits = 2) =>
	Number(value).toLocaleString('pt-BR', {
		minimumFractionDigits: 0,
		maximumFractionDigits: digits,
	});

/** Classes do orquestrador ("stocks", "fiis") como a pessoa lê. */
export const BUCKET_LABEL: Record<string, string> = {
	stocks: 'Ações',
	crypto: 'Cripto',
	fiis: 'FIIs',
	other: 'Outros',
	equities: 'Ações',
	real_estate: 'FIIs',
	etf: 'ETFs',
	fund: 'Renda fixa',
};

export const bucketLabel = (key: string | null | undefined) =>
	(key && BUCKET_LABEL[key]) || key || 'Outros';

/** Frase fixa das opções: o Trackerr mostra consequências, não recomenda. */
export const DECISION_NOTE =
	'A decisão é sua: o Trackerr mostra as consequências, não recomenda investimentos.';
