import { Schema, model } from 'mongoose';

/**
 * Dados abertos de fundos da CVM (TRA-276). As três coleções são
 * regeneráveis pelos jobs de leitura: nada aqui é dado de usuário.
 */

export interface InvestmentFundClassDocument {
	_id: string;
	name: string;
	searchName: string;
	classification: string | null;
	status: string;
	condominium: string | null;
	exclusive: boolean;
	targetAudience: string | null;
	subclasses: Array<{ id: string; name: string }>;
	syncedAt: Date;
}

const classSchema = new Schema<InvestmentFundClassDocument>(
	{
		_id: { type: String, required: true },
		name: { type: String, required: true },
		searchName: { type: String, required: true },
		classification: { type: String, default: null },
		status: { type: String, required: true },
		condominium: { type: String, default: null },
		exclusive: { type: Boolean, default: false },
		targetAudience: { type: String, default: null },
		subclasses: {
			type: [
				new Schema(
					{
						id: { type: String, required: true },
						name: { type: String, required: true },
					},
					{ _id: false }
				),
			],
			default: [],
		},
		syncedAt: { type: Date, required: true },
	},
	{ collection: 'investment_fund_classes', versionKey: false }
);
classSchema.index({ syncedAt: 1 });

export const InvestmentFundClassModel = model<InvestmentFundClassDocument>(
	'InvestmentFundClass',
	classSchema
);

export interface InvestmentFundQuoteDocument {
	/** CNPJ, ou `CNPJ:ID_SUBCLASSE` para cota de subclasse. */
	_id: string;
	cnpj: string;
	subclassId: string | null;
	date: string;
	quota: number;
	netAssetValue: number | null;
	investorCount: number | null;
	sourceUrl: string;
	updatedAt: Date;
}

const quoteSchema = new Schema<InvestmentFundQuoteDocument>(
	{
		_id: { type: String, required: true },
		cnpj: { type: String, required: true },
		subclassId: { type: String, default: null },
		date: { type: String, required: true },
		quota: { type: Number, required: true },
		netAssetValue: { type: Number, default: null },
		investorCount: { type: Number, default: null },
		sourceUrl: { type: String, required: true },
		updatedAt: { type: Date, required: true },
	},
	{ collection: 'investment_fund_quotes', versionKey: false }
);
quoteSchema.index({ cnpj: 1 });

export const InvestmentFundQuoteModel = model<InvestmentFundQuoteDocument>(
	'InvestmentFundQuote',
	quoteSchema
);

export interface InvestmentFundIngestionDocument {
	_id: string;
	sourceUrl: string;
	sha256: string;
	rows: number;
	latestDate: string | null;
	ingestedAt: Date;
}

const ingestionSchema = new Schema<InvestmentFundIngestionDocument>(
	{
		_id: { type: String, required: true },
		sourceUrl: { type: String, required: true },
		sha256: { type: String, required: true },
		rows: { type: Number, required: true },
		latestDate: { type: String, default: null },
		ingestedAt: { type: Date, required: true },
	},
	{ collection: 'investment_fund_ingestions', versionKey: false }
);

export const InvestmentFundIngestionModel =
	model<InvestmentFundIngestionDocument>(
		'InvestmentFundIngestion',
		ingestionSchema
	);
