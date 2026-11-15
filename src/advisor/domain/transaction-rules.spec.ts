import { AssetClass, TransactionSide } from './enums';
import { TransactionInput } from './portfolio.entities';
import { normalizeSymbol, validateTransactionInput } from './transaction-rules';

const today = '2025-06-10';

function valid(): TransactionInput {
	return {
		symbol: 'PETR4',
		assetClass: AssetClass.Stock,
		side: TransactionSide.Buy,
		quantity: 100,
		unitPriceMinor: 3500,
		feesMinor: 100,
		currency: 'BRL',
		tradeDate: '2025-06-10',
	};
}

describe('validateTransactionInput', () => {
	it('entrada valida nao tem erro', () => {
		expect(validateTransactionInput(valid(), today)).toEqual([]);
	});

	it('aceita liquidityDays nos limites e quantidade fracionada', () => {
		expect(
			validateTransactionInput(
				{ ...valid(), liquidityDays: 3650, quantity: 0.12345678 },
				today
			)
		).toEqual([]);
		expect(
			validateTransactionInput({ ...valid(), liquidityDays: 0 }, today)
		).toEqual([]);
	});

	it.each([
		[{ symbol: 'PETR 4' }, 'INVALID_SYMBOL'],
		[{ symbol: '' }, 'INVALID_SYMBOL'],
		[{ quantity: 0 }, 'INVALID_QUANTITY'],
		[{ quantity: NaN }, 'INVALID_QUANTITY'],
		[{ quantity: 0.123456789 }, 'INVALID_QUANTITY'],
		[{ quantity: 1e12 + 1 }, 'INVALID_QUANTITY'],
		[{ unitPriceMinor: 0 }, 'INVALID_PRICE'],
		[{ unitPriceMinor: 10.5 }, 'INVALID_PRICE'],
		[{ feesMinor: -1 }, 'INVALID_FEES'],
		[{ currency: 'USD' }, 'UNSUPPORTED_CURRENCY'],
		[{ tradeDate: '2025-02-30' }, 'INVALID_DATE'],
		[{ tradeDate: '10/06/2025' }, 'INVALID_DATE'],
		[{ tradeDate: '2025-06-11' }, 'DATE_IN_FUTURE'],
		[{ tradeDate: '1989-12-31' }, 'DATE_TOO_OLD'],
		[{ liquidityDays: -1 }, 'INVALID_LIQUIDITY_DAYS'],
		[{ liquidityDays: 3651 }, 'INVALID_LIQUIDITY_DAYS'],
		[{ liquidityDays: 1.5 }, 'INVALID_LIQUIDITY_DAYS'],
		[{ quantity: 1e12, unitPriceMinor: 1e6 }, 'AMOUNT_OVERFLOW'],
		[{ assetClass: 'GOLD' }, 'INVALID_ASSET_CLASS'],
		[{ side: 'HOLD' }, 'INVALID_SIDE'],
	])('%j => %s', (patch, code) => {
		expect(
			validateTransactionInput({ ...valid(), ...patch } as never, today)
		).toContain(code);
	});
});

describe('normalizeSymbol', () => {
	it('apara e poe em maiusculas', () => {
		expect(normalizeSymbol(' petr4 ')).toBe('PETR4');
	});
});
