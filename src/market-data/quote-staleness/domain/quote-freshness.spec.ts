import { normalizeSymbol, readStaleness } from './quote-freshness';

describe('frescor de cotacao — dominio (TRA-136, fase 7)', () => {
	const now = new Date('2026-03-05T12:00:00.000Z');

	it('normaliza simbolo (trim + maiuscula) e trata lixo como vazio', () => {
		expect(normalizeSymbol(' petr4 ')).toBe('PETR4');
		expect(normalizeSymbol(null)).toBe('');
		expect(normalizeSymbol(undefined)).toBe('');
	});

	it('mede a idade da ultima leitura em minutos cheios', () => {
		const leitura = readStaleness(
			{ symbol: 'petr4', lastQuoteAt: new Date('2026-03-05T10:30:30.000Z') },
			now
		);

		expect(leitura).toEqual({
			symbol: 'PETR4',
			lastQuoteAt: new Date('2026-03-05T10:30:30.000Z'),
			minutesSinceLastQuote: 89,
		});
	});

	/**
	 * O falso positivo que este produtor existe para nao cometer: simbolo sem
	 * registro nunca foi lido com sucesso, e "nunca foi lido" nao e "parou de
	 * atualizar". Fosse tratado como atraso, o primeiro deploy — com a
	 * colecao vazia — alertaria a base inteira.
	 */
	it('sem registro nao ha leitura: nao existe atraso a reportar', () => {
		expect(readStaleness(null, now)).toBeNull();
		expect(readStaleness(undefined, now)).toBeNull();
	});

	it('carimbo invalido nao vira leitura', () => {
		expect(
			readStaleness(
				{ symbol: 'PETR4', lastQuoteAt: new Date('nao-e-data') },
				now
			)
		).toBeNull();
	});

	it('carimbo no futuro nao vira atraso negativo', () => {
		expect(
			readStaleness(
				{ symbol: 'PETR4', lastQuoteAt: new Date('2026-03-05T13:00:00.000Z') },
				now
			)
		).toBeNull();
	});
});
