import { Schema, model } from 'mongoose';

/**
 * Último pregão do Tesouro Direto lido do Tesouro Transparente (TRA-269).
 * Um único documento (`_id: 'latest'`): a coleção é integralmente regenerável
 * pelo job de leitura e só o pregão mais recente interessa.
 */
export interface TesouroOffersSnapshotDocument {
	_id: string;
	baseDate: string;
	sourceUrl: string;
	fetchedAt: Date;
	titles: Array<{
		id: string;
		family: string;
		name: string;
		maturityDate: string;
		buyRatePct: number;
		sellRatePct: number;
		unitPrice: number;
		baseDate: string;
	}>;
}

const titleSchema = new Schema(
	{
		id: { type: String, required: true },
		family: { type: String, required: true },
		name: { type: String, required: true },
		maturityDate: { type: String, required: true },
		buyRatePct: { type: Number, required: true },
		sellRatePct: { type: Number, required: true },
		unitPrice: { type: Number, required: true },
		baseDate: { type: String, required: true },
	},
	{ _id: false }
);

const tesouroOffersSnapshotSchema = new Schema<TesouroOffersSnapshotDocument>(
	{
		_id: { type: String, required: true },
		baseDate: { type: String, required: true },
		sourceUrl: { type: String, required: true },
		fetchedAt: { type: Date, required: true },
		titles: { type: [titleSchema], default: [] },
	},
	{ collection: 'tesouro_offers_snapshots', versionKey: false }
);

export const TesouroOffersSnapshotModel = model<TesouroOffersSnapshotDocument>(
	'TesouroOffersSnapshot',
	tesouroOffersSnapshotSchema
);
