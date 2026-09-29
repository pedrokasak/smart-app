/**
 * Codigo CVM de uma companhia aberta, no formato usado pelo registro de
 * empresas listadas da B3 (TRA-260).
 *
 * As duas fontes escrevem o mesmo codigo de jeitos diferentes: o ENET mostra
 * o codigo com o digito verificador separado ("01610-1") e a B3 traz tudo
 * junto, sem zeros a esquerda ("16101"). A forma canonica e a da B3: so
 * digitos, digito verificador incluido, sem zeros a esquerda.
 */
export function normalizeCvmCode(value: unknown): string | null {
	const digits = String(value ?? '')
		.replace(/\D/g, '')
		.replace(/^0+/, '');
	return digits || null;
}
