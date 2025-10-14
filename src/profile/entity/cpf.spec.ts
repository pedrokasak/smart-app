import Cpf from 'src/profile/entity/cpf';

describe('Cpf', () => {
	it('should accept a valid CPF', () => {
		const validCpf = '712.532.810-50';
		const cpfInstance = new Cpf(validCpf);
		expect(cpfInstance.value).toBe('71253281050'); // valor limpo sem pontos ou traço
	});

	it('should reject an invalid CPF', () => {
		const invalidCpf = '11111';
		expect(() => new Cpf(invalidCpf)).toThrow('Invalid Cpf!');
	});

	it('should reject a blocked CPF (all digits equal)', () => {
		const blockedCpf = '111.111.111-11';
		expect(() => new Cpf(blockedCpf)).toThrow('Invalid Cpf!');
	});

	it('should remove dots and dashes', () => {
		const cpf = new Cpf('712.532.810-50');
		expect(cpf.value).toBe('71253281050');
	});
});
