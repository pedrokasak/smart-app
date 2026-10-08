import { formatCnpj, normalizeCnpj } from './cnpj';

describe('normalizeCnpj', () => {
	it('accepts a real CNPJ with or without mask', () => {
		// Classe do Informe Diário de 09/2026.
		expect(normalizeCnpj('00.017.024/0001-53')).toBe('00017024000153');
		expect(normalizeCnpj('00017024000153')).toBe('00017024000153');
	});

	it('rejects wrong check digits', () => {
		expect(normalizeCnpj('00.017.024/0001-54')).toBeNull();
		expect(normalizeCnpj('00.017.024/0001-63')).toBeNull();
	});

	it('rejects repeated digits, wrong length and non-strings', () => {
		expect(normalizeCnpj('00000000000000')).toBeNull();
		expect(normalizeCnpj('11111111111111')).toBeNull();
		expect(normalizeCnpj('0001702400015')).toBeNull();
		expect(normalizeCnpj('PETR4')).toBeNull();
		expect(normalizeCnpj(undefined)).toBeNull();
	});
});

describe('formatCnpj', () => {
	it('applies the mask', () => {
		expect(formatCnpj('00017024000153')).toBe('00.017.024/0001-53');
	});
});
