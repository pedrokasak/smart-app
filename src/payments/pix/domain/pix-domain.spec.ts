import { formatCpf, isValidCpf, normalizeCpf } from './cpf';
import { pixAmountFor, pixDueDate, pixPeriodFor } from './pix-billing';

describe('CPF (TRA-195)', () => {
	it.each(['529.982.247-25', '52998224725', ' 529.982.247-25 '])(
		'aceita CPF válido %p',
		(cpf) => expect(isValidCpf(cpf)).toBe(true)
	);

	it.each([
		['dígito verificador errado', '529.982.247-26'],
		['todos iguais', '111.111.111-11'],
		['zeros', '000.000.000-00'],
		['curto', '5299822472'],
		['longo', '529982247250'],
		['vazio', ''],
		['nulo', null],
	])('recusa %s', (_label, cpf) => expect(isValidCpf(cpf as any)).toBe(false));

	it('normaliza para dígitos e formata no padrão do schema', () => {
		expect(normalizeCpf('529.982.247-25')).toBe('52998224725');
		expect(formatCpf('52998224725')).toBe('529.982.247-25');
	});
});

describe('pixAmountFor', () => {
	it('usa o preço mensal ou anual do plano', () => {
		const plan = { price: 14.9, annualPrice: 149, isActive: true };
		expect(pixAmountFor(plan, 'month')).toBe(14.9);
		expect(pixAmountFor(plan, 'year')).toBe(149);
	});

	it.each([
		['plano gratuito', { price: 0 }, 'month'],
		['plano inativo', { price: 14.9, isActive: false }, 'month'],
		['sem preço anual', { price: 14.9 }, 'year'],
		['preço inválido', { price: Number.NaN }, 'month'],
	] as const)('recusa %s', (_label, plan, interval) =>
		expect(pixAmountFor(plan as any, interval)).toBeNull()
	);

	it('arredonda para centavos', () => {
		expect(pixAmountFor({ price: 14.899999 }, 'month')).toBe(14.9);
	});
});

describe('pixPeriodFor', () => {
	const paidAt = new Date('2026-09-24T15:00:00Z');

	it('primeira compra começa no pagamento', () => {
		expect(pixPeriodFor('month', paidAt)).toEqual({
			start: paidAt,
			end: new Date('2026-10-24T15:00:00Z'),
		});
	});

	it('renovação antecipada emenda no fim do período atual, sem perder dias', () => {
		const currentEnd = new Date('2026-10-01T00:00:00Z');
		expect(pixPeriodFor('month', paidAt, currentEnd)).toEqual({
			start: currentEnd,
			end: new Date('2026-11-01T00:00:00Z'),
		});
	});

	it('período já vencido não é emendado', () => {
		const pastEnd = new Date('2026-09-01T00:00:00Z');
		expect(pixPeriodFor('month', paidAt, pastEnd).start).toEqual(paidAt);
	});

	it('anual soma 12 meses', () => {
		expect(pixPeriodFor('year', paidAt).end).toEqual(
			new Date('2027-09-24T15:00:00Z')
		);
	});

	it('31/01 + 1 mês = último dia de fevereiro, sem transbordar para março', () => {
		expect(pixPeriodFor('month', new Date('2027-01-31T12:00:00Z')).end).toEqual(
			new Date('2027-02-28T12:00:00Z')
		);
		expect(pixPeriodFor('month', new Date('2028-01-31T12:00:00Z')).end).toEqual(
			new Date('2028-02-29T12:00:00Z')
		);
	});

	it('29/02 + 1 ano = 28/02', () => {
		expect(pixPeriodFor('year', new Date('2028-02-29T12:00:00Z')).end).toEqual(
			new Date('2029-02-28T12:00:00Z')
		);
	});
});

describe('pixDueDate', () => {
	it('vence no dia seguinte pelo calendário de Brasília', () => {
		expect(pixDueDate(new Date('2026-09-24T15:00:00Z'))).toBe('2026-09-25');
	});

	it('às 23h30 em Brasília (02h30 UTC do dia seguinte) ainda conta o dia local', () => {
		expect(pixDueDate(new Date('2026-09-25T02:30:00Z'))).toBe('2026-09-25');
	});
});
