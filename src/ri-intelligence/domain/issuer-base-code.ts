/**
 * Codigo do emissor: o ticker sem os digitos da classe (PETR4 -> PETR,
 * TAEE11 -> TAEE, B3SA3 -> B3SA). Mesma regra do registro da B3 que liga
 * ticker a CNPJ e a codigo CVM.
 *
 * E o que junta as classes de uma empresa: detentores de PETR3 e de PETR4
 * recebem o mesmo aviso (TRA-261), e a pergunta sobre a PETR4 busca nos
 * documentos da Petrobras, qualquer que seja a classe sob a qual o vigia os
 * registrou (TRA-264).
 */
export function issuerBaseCode(ticker: string): string | null {
	const normalized = String(ticker ?? '')
		.trim()
		.toUpperCase()
		.replace(/\.SA$/, '');
	const match = /^([A-Z0-9]{4})\d{1,2}$/.exec(normalized);
	return match ? match[1] : null;
}
