import { normalizeCvmCode } from 'src/ri-intelligence/domain/cvm-code';

describe('normalizeCvmCode (TRA-260)', () => {
	// Pares reais conferidos em 28/09/2026: o ENET mostra "01610-1" e o
	// registro da B3 traz "16101" para a Gafisa (idem Ambipar 02496-1/24961).
	it.each([
		['01610-1', '16101'],
		['16101', '16101'],
		['02496-1', '24961'],
		['00090-6', '906'],
		[' 900049 ', '900049'],
	])('normalizes %s to %s', (raw, expected) => {
		expect(normalizeCvmCode(raw)).toBe(expected);
	});

	it.each(['', '  ', '0', '00000-0', null, undefined, 'abc'])(
		'has no code for %p',
		(raw) => {
			expect(normalizeCvmCode(raw)).toBeNull();
		}
	);
});
