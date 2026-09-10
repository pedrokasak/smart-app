import {
	easterSunday,
	holidaysForYear,
	isTradingDay,
	nonTradingReason,
} from './trading-calendar';

describe('trading-calendar', () => {
	describe('easterSunday', () => {
		// Datas conferidas contra o calendario gregoriano.
		it.each([
			[2023, '2023-04-09'],
			[2024, '2024-03-31'],
			[2025, '2025-04-20'],
			[2026, '2026-04-05'],
			[2027, '2027-03-28'],
		])('calcula a Pascoa de %i', (year, expected) => {
			expect(easterSunday(year).toISOString().slice(0, 10)).toBe(expected);
		});
	});

	describe('feriados moveis', () => {
		it('deriva Carnaval, Sexta-feira Santa e Corpus Christi de 2025', () => {
			const days = holidaysForYear(2025);
			// Pascoa 2025 = 20/04
			expect(days.has('2025-03-03')).toBe(true); // Carnaval segunda
			expect(days.has('2025-03-04')).toBe(true); // Carnaval terca
			expect(days.has('2025-04-18')).toBe(true); // Sexta-feira Santa
			expect(days.has('2025-06-19')).toBe(true); // Corpus Christi
		});
	});

	describe('feriados fixos', () => {
		it('inclui os nacionais de data fixa', () => {
			const days = holidaysForYear(2025);
			for (const day of [
				'2025-01-01',
				'2025-04-21',
				'2025-05-01',
				'2025-09-07',
				'2025-10-12',
				'2025-11-02',
				'2025-11-15',
				'2025-12-25',
			]) {
				expect(days.has(day)).toBe(true);
			}
		});

		// Consciencia Negra virou feriado nacional pela Lei 14.759/2023.
		it('so inclui 20/11 a partir de 2024', () => {
			expect(holidaysForYear(2023).has('2023-11-20')).toBe(false);
			expect(holidaysForYear(2024).has('2024-11-20')).toBe(true);
		});
	});

	describe('nonTradingReason', () => {
		it('reconhece fim de semana', () => {
			expect(nonTradingReason('2025-06-07')).toBe('weekend'); // sabado
			expect(nonTradingReason('2025-06-08')).toBe('weekend'); // domingo
		});

		it('reconhece feriado em dia util', () => {
			expect(nonTradingReason('2025-05-01')).toBe('holiday'); // quinta
		});

		it('devolve null em dia de pregao', () => {
			expect(nonTradingReason('2025-06-10')).toBeNull(); // terca comum
			expect(isTradingDay('2025-06-10')).toBe(true);
		});

		// Fim de semana vence: um feriado que cai no sabado nao tira pregao de
		// nada, e classificar como 'holiday' sugeriria um dia util perdido.
		it('classifica feriado em fim de semana como weekend', () => {
			// 2025-11-15 (Proclamacao da Republica) cai num sabado.
			expect(nonTradingReason('2025-11-15')).toBe('weekend');
		});

		it('nao quebra com data invalida', () => {
			expect(nonTradingReason('nao-e-data')).toBeNull();
		});
	});

	// O motivo do modulo existir: um mes com 30 pontos onde so ~21 sao pregao
	// dilui desvio-padrao e retorno por construcao.
	it('conta os pregoes de um mes corretamente', () => {
		const june2025 = Array.from({ length: 30 }, (_, i) =>
			`2025-06-${String(i + 1).padStart(2, '0')}`
		);
		const tradingDays = june2025.filter(isTradingDay);

		// Junho/2025: 30 dias, 9 de fim de semana, Corpus Christi (19/06).
		expect(tradingDays).toHaveLength(20);
	});
});
