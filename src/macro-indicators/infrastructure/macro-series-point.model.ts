import { Schema, Types, model } from 'mongoose';

/**
 * Espelho local das séries macro do BACEN (TRA-227). Um documento por série e
 * dia de referência.
 *
 * Nada aqui é fonte de verdade: a coleção é integralmente regenerável pelo
 * job de sincronização. Existe para tirar o BACEN do caminho de cada
 * requisição e para guardar quando cada valor foi lido na origem
 * (`fetchedAt`) — parte da procedência exigida pela licença ODbL.
 */
export interface MacroSeriesPointDocument {
	_id?: Types.ObjectId;
	/** Código no SGS (12 = CDI, 433 = IPCA, 432 = Selic meta). */
	seriesCode: number;
	/** YYYY-MM-DD — string para ordenar e filtrar sem fuso. */
	date: string;
	value: number;
	fetchedAt: Date;
}

const macroSeriesPointSchema = new Schema<MacroSeriesPointDocument>(
	{
		seriesCode: { type: Number, required: true },
		date: { type: String, required: true },
		value: { type: Number, required: true },
		fetchedAt: { type: Date, required: true },
	},
	{ collection: 'macro_series_points', versionKey: false }
);

// Serve às três consultas (intervalo, último ponto, upsert) e fecha a corrida
// entre duas sincronizações concorrentes.
macroSeriesPointSchema.index({ seriesCode: 1, date: 1 }, { unique: true });

export const MacroSeriesPointModel = model<MacroSeriesPointDocument>(
	'MacroSeriesPoint',
	macroSeriesPointSchema
);
