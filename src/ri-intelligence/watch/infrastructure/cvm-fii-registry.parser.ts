import Papa from 'papaparse';

/**
 * ISIN de cota de FII na B3: "BR" + codigo de negociacao (4) + "CTF" + ...
 * (`BRHGLGCTF004` -> HGLG). Recibo e direito de subscricao tem outro
 * miolo (`BRHGLGR26M17`) e ficam de fora: o ticker deles resolve pelo
 * mesmo codigo da cota.
 */
const FII_QUOTA_ISIN = /^BR([A-Z0-9]{4})CTF/;

interface InformeGeralRow {
	CNPJ_Fundo_Classe?: string;
	/** Nome da coluna antes da CVM 175. */
	CNPJ_Fundo?: string;
	Codigo_ISIN?: string;
	Data_Referencia?: string;
}

/**
 * Codigo do FII -> CNPJ (so digitos), a partir do CSV geral do informe
 * mensal de FII da CVM (`inf_mensal_fii_geral_AAAA.csv`, TRA-266). Um fundo
 * aparece uma vez por mes; vale o CNPJ do informe mais recente — o de um
 * fundo que mudou de CNPJ (fundo -> classe, na CVM 175) e o atual.
 */
export function parseFiiRegistry(csvText: string): Map<string, string> {
	const parsed = Papa.parse<InformeGeralRow>(csvText, {
		header: true,
		delimiter: ';',
		skipEmptyLines: true,
	});
	const latest = new Map<string, { cnpj: string; reference: string }>();
	for (const row of parsed.data ?? []) {
		const code = FII_QUOTA_ISIN.exec(
			String(row?.Codigo_ISIN ?? '')
				.trim()
				.toUpperCase()
		)?.[1];
		const digits = String(row?.CNPJ_Fundo_Classe ?? row?.CNPJ_Fundo ?? '')
			.replace(/\D/g, '')
			.padStart(14, '0');
		if (!code || /^0+$/.test(digits) || digits.length !== 14) continue;
		const reference = String(row?.Data_Referencia ?? '').trim();
		const current = latest.get(code);
		if (!current || reference > current.reference) {
			latest.set(code, { cnpj: digits, reference });
		}
	}
	return new Map([...latest].map(([code, { cnpj }]) => [code, cnpj]));
}
