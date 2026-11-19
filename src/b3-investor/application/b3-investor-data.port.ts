import type {
	B3AssetTrade,
	B3AuthorizedInvestor,
	B3DateRange,
	B3EquityMovement,
	B3EquityPosition,
	B3FixedIncomePosition,
	B3ReferenceDate,
	B3TreasuryBondPosition,
	B3UpdatedProduct,
} from 'src/b3-investor/domain/b3-investor.types';

export const B3_INVESTOR_DATA = Symbol('B3_INVESTOR_DATA');

/**
 * Leitura dos dados de custódia de um investidor que autorizou o Trackerr
 * na Área do Investidor da B3 (TRA-185).
 *
 * Regras da B3 que quem chama precisa respeitar:
 * - consultar cada CPF no máximo uma vez por dia;
 * - usar `listUpdatedInvestors` para descobrir quem mudou, em vez de varrer
 *   todos os CPFs;
 * - dados D-1, disponíveis a partir de 11/2019.
 *
 * Todas as falhas chegam como `B3InvestorError`.
 */
export interface B3InvestorDataPort {
	/** Confere token + certificado contra `/api/acesso/healthcheck`. */
	healthcheck(): Promise<void>;

	/** CPFs/CNPJs com consentimento ativo para o Trackerr. */
	listAuthorizedInvestors(): Promise<B3AuthorizedInvestor[]>;

	/** API Guia: documentos que têm dado novo no produto e período. */
	listUpdatedInvestors(
		product: B3UpdatedProduct,
		range: B3DateRange
	): Promise<string[]>;

	getEquityPositions(
		documentNumber: string,
		referenceDate: B3ReferenceDate
	): Promise<B3EquityPosition[]>;

	getTreasuryBondPositions(
		documentNumber: string,
		referenceDate: B3ReferenceDate
	): Promise<B3TreasuryBondPosition[]>;

	getFixedIncomePositions(
		documentNumber: string,
		referenceDate: B3ReferenceDate
	): Promise<B3FixedIncomePosition[]>;

	getEquityMovements(
		documentNumber: string,
		range: B3DateRange
	): Promise<B3EquityMovement[]>;

	getAssetTrades(
		documentNumber: string,
		range: B3DateRange
	): Promise<B3AssetTrade[]>;
}
