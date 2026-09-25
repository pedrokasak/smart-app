/**
 * CPF para cobrança PIX (TRA-195). O Asaas exige `cpfCnpj` no cliente para
 * emitir cobrança; validar aqui evita criar cliente lixo lá e devolver um erro
 * genérico do provedor ao usuário.
 */

/** Só dígitos, ou `null` quando não há 11. */
export function normalizeCpf(raw: string | null | undefined): string | null {
	const digits = String(raw ?? '').replace(/\D/g, '');
	return digits.length === 11 ? digits : null;
}

/** Dígitos verificadores de verdade — não só o formato. */
export function isValidCpf(raw: string | null | undefined): boolean {
	const cpf = normalizeCpf(raw);
	if (!cpf) return false;
	// 000.000.000-00, 111.111.111-11... passam no cálculo e não existem.
	if (/^(\d)\1{10}$/.test(cpf)) return false;

	const digit = (length: number) => {
		let sum = 0;
		for (let i = 0; i < length; i++) {
			sum += Number(cpf[i]) * (length + 1 - i);
		}
		const rest = (sum * 10) % 11;
		return rest === 10 ? 0 : rest;
	};

	return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

/** Formato gravado em `User.cpf` (o schema exige `000.000.000-00`). */
export function formatCpf(raw: string): string {
	const cpf = normalizeCpf(raw);
	if (!cpf) throw new Error('CPF inválido');
	return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}
