/**
 * CNPJ de classe de fundo (TRA-276). É o identificador da posição
 * `investment_fund`: o símbolo do ativo guarda os 14 dígitos, sem máscara.
 */

const WEIGHTS_FIRST = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const WEIGHTS_SECOND = [6, ...WEIGHTS_FIRST];

function checkDigit(digits: string, weights: number[]): number {
	const sum = weights.reduce(
		(acc, weight, index) => acc + Number(digits[index]) * weight,
		0
	);
	const rest = sum % 11;
	return rest < 2 ? 0 : 11 - rest;
}

/** Só os 14 dígitos de um CNPJ válido; `null` para qualquer outra coisa. */
export function normalizeCnpj(value: unknown): string | null {
	const digits = String(value ?? '').replace(/\D/g, '');
	if (digits.length !== 14) return null;
	// "00000000000000" e afins passam no dígito verificador e não são CNPJ.
	if (/^(\d)\1{13}$/.test(digits)) return null;
	if (checkDigit(digits, WEIGHTS_FIRST) !== Number(digits[12])) return null;
	if (checkDigit(digits, WEIGHTS_SECOND) !== Number(digits[13])) return null;
	return digits;
}

/** "00017024000153" → "00.017.024/0001-53". */
export function formatCnpj(digits: string): string {
	return digits.replace(
		/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
		'$1.$2.$3/$4-$5'
	);
}
