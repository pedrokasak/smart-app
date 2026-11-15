import { AssetClass, TransactionSide } from './enums';
import { TransactionInput } from './portfolio.entities';

export type TransactionRuleError =
	| 'INVALID_SYMBOL'
	| 'INVALID_QUANTITY'
	| 'INVALID_PRICE'
	| 'INVALID_FEES'
	| 'UNSUPPORTED_CURRENCY'
	| 'INVALID_DATE'
	| 'DATE_IN_FUTURE'
	| 'DATE_TOO_OLD'
	| 'INVALID_ASSET_CLASS'
	| 'INVALID_SIDE'
	| 'INVALID_LIQUIDITY_DAYS'
	| 'AMOUNT_OVERFLOW';

const SYMBOL_PATTERN = /^[A-Z0-9.-]{1,20}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_TRADE_DATE = '1990-01-01';
const MAX_QUANTITY = 1e12;
const MAX_QUANTITY_DECIMALS = 8;
const MAX_LIQUIDITY_DAYS = 3650;
const SUPPORTED_CURRENCY = 'BRL';

export function normalizeSymbol(raw: string): string {
	return raw.trim().toUpperCase();
}

function isValidSymbol(raw: unknown): boolean {
	return typeof raw === 'string' && SYMBOL_PATTERN.test(normalizeSymbol(raw));
}

function isValidQuantity(quantity: unknown): quantity is number {
	return (
		typeof quantity === 'number' &&
		Number.isFinite(quantity) &&
		quantity > 0 &&
		quantity <= MAX_QUANTITY &&
		Number(quantity.toFixed(MAX_QUANTITY_DECIMALS)) === quantity
	);
}

function isPositiveInteger(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) >= 0;
}

function isRealCalendarDate(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	const match = DATE_PATTERN.exec(value);
	if (!match) return false;
	const [year, month, day] = [
		Number(match[1]),
		Number(match[2]),
		Number(match[3]),
	];
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day
	);
}

export function validateTransactionInput(
	input: TransactionInput,
	today: string
): TransactionRuleError[] {
	const errors: TransactionRuleError[] = [];

	if (!isValidSymbol(input.symbol)) errors.push('INVALID_SYMBOL');
	if (!Object.values(AssetClass).includes(input.assetClass)) {
		errors.push('INVALID_ASSET_CLASS');
	}
	if (!Object.values(TransactionSide).includes(input.side)) {
		errors.push('INVALID_SIDE');
	}

	const quantityOk = isValidQuantity(input.quantity);
	const priceOk = isPositiveInteger(input.unitPriceMinor);
	if (!quantityOk) errors.push('INVALID_QUANTITY');
	if (!priceOk) errors.push('INVALID_PRICE');
	if (!isNonNegativeInteger(input.feesMinor)) errors.push('INVALID_FEES');
	if (
		quantityOk &&
		priceOk &&
		input.quantity * input.unitPriceMinor > Number.MAX_SAFE_INTEGER
	) {
		errors.push('AMOUNT_OVERFLOW');
	}

	if (input.currency !== SUPPORTED_CURRENCY) {
		errors.push('UNSUPPORTED_CURRENCY');
	}

	if (!isRealCalendarDate(input.tradeDate)) {
		errors.push('INVALID_DATE');
	} else if (input.tradeDate < MIN_TRADE_DATE) {
		errors.push('DATE_TOO_OLD');
	} else if (input.tradeDate > today) {
		errors.push('DATE_IN_FUTURE');
	}

	if (
		input.liquidityDays !== undefined &&
		!(
			Number.isInteger(input.liquidityDays) &&
			input.liquidityDays >= 0 &&
			input.liquidityDays <= MAX_LIQUIDITY_DAYS
		)
	) {
		errors.push('INVALID_LIQUIDITY_DAYS');
	}

	return errors;
}
