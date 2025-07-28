export default class Cpf {
	value: string;

	constructor(value: string) {
		if (!this.validationCpf(value)) throw new Error('Invalid Cpf!');
		this.value = value;
	}

	FACTOR_DIGIT_1 = 10;
	FACTOR_DIGIT_2 = 11;

	private validationCpf(rawCpf: string) {
		if (!rawCpf) return false;
		const cpf = this.clean(rawCpf);
		if (!this.isValidLength(cpf)) return false;
		if (this.isBlockedCpf(cpf)) return false;
		const digit1 = this.calculateDigit(cpf, this.FACTOR_DIGIT_1);
		const digit2 = this.calculateDigit(cpf, this.FACTOR_DIGIT_2);
		const actualDigit = this.extractActualDigit(cpf);
		const calculatedDigit = `${digit1}${digit2}`;
		return actualDigit === calculatedDigit;
	}

	private clean(cpf: string) {
		return (cpf = cpf.replace(/[\.\-]*/g, ''));
	}

	private isValidLength(cpf: string) {
		return cpf.length === 11;
	}

	private isBlockedCpf(cpf: string) {
		const [firstDigit] = cpf;
		return [...cpf].every((digit) => digit === firstDigit);
	}

	private calculateDigit(cpf: string, factor: number) {
		let total = 0;
		for (const digit of cpf) {
			if (factor > 1) total += parseInt(digit) * factor--;
		}
		const rest = total % 11;
		return rest < 2 ? 0 : 11 - rest;
	}

	private extractActualDigit(cpf: string) {
		return cpf.slice(9);
	}
}
