import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type {
	IngestionRecord,
	InvestmentFundStore,
	StoredFundQuote,
} from '../application/ports/investment-funds.ports';
import type { InvestmentFundClass } from '../domain/fund-class';
import { FundQuote, fundQuoteKey } from '../domain/fund-quote';
import { escapeRegex, searchTerms, toSearchText } from '../domain/search-text';
import type {
	InvestmentFundClassDocument,
	InvestmentFundIngestionDocument,
	InvestmentFundQuoteDocument,
} from './investment-fund.models';

const BATCH = 1000;

function chunks<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		out.push(items.slice(i, i + size));
	}
	return out;
}

const toClass = (doc: InvestmentFundClassDocument): InvestmentFundClass => ({
	cnpj: doc._id,
	name: doc.name,
	classification: doc.classification ?? null,
	status: doc.status,
	condominium: doc.condominium ?? null,
	exclusive: !!doc.exclusive,
	targetAudience: doc.targetAudience ?? null,
	subclasses: (doc.subclasses ?? []).map(({ id, name }) => ({ id, name })),
});

/** Único arquivo do módulo que conhece Mongoose (fora o gravador das posições). */
@Injectable()
export class MongoInvestmentFundStore implements InvestmentFundStore {
	constructor(
		@InjectModel('InvestmentFundClass')
		private readonly classes: Model<InvestmentFundClassDocument>,
		@InjectModel('InvestmentFundQuote')
		private readonly quotes: Model<InvestmentFundQuoteDocument>,
		@InjectModel('InvestmentFundIngestion')
		private readonly ingestions: Model<InvestmentFundIngestionDocument>
	) {}

	/**
	 * Upsert de todas as classes do arquivo e remoção das que saíram dele
	 * (canceladas desde a última leitura). Quem saiu só é apagado depois que
	 * todas as atuais foram gravadas: uma falha no meio deixa classe a mais,
	 * nunca a menos.
	 */
	async replaceClasses(list: InvestmentFundClass[]): Promise<number> {
		const syncedAt = new Date();
		for (const batch of chunks(list, BATCH)) {
			await this.classes.bulkWrite(
				batch.map((item) => ({
					replaceOne: {
						filter: { _id: item.cnpj },
						replacement: {
							_id: item.cnpj,
							name: item.name,
							searchName: toSearchText(item.name),
							classification: item.classification,
							status: item.status,
							condominium: item.condominium,
							exclusive: item.exclusive,
							targetAudience: item.targetAudience,
							subclasses: item.subclasses,
							syncedAt,
						},
						upsert: true,
					},
				})),
				{ ordered: false }
			);
		}
		await this.classes.deleteMany({ syncedAt: { $lt: syncedAt } }).exec();
		return list.length;
	}

	async upsertLatestQuotes(
		list: FundQuote[],
		sourceUrl: string
	): Promise<number> {
		let written = 0;
		const updatedAt = new Date();
		for (const batch of chunks(list, BATCH)) {
			const keys = batch.map((quote) =>
				fundQuoteKey(quote.cnpj, quote.subclassId)
			);
			const current = await this.quotes
				.find({ _id: { $in: keys } }, { date: 1 })
				.lean()
				.exec();
			const storedDate = new Map(current.map((doc) => [doc._id, doc.date]));

			// Reapresentação de mês antigo não pode trazer cota de volta no tempo.
			const fresh = batch.filter((quote) => {
				const date = storedDate.get(fundQuoteKey(quote.cnpj, quote.subclassId));
				return !date || quote.date >= date;
			});
			if (!fresh.length) continue;

			await this.quotes.bulkWrite(
				fresh.map((quote) => {
					const _id = fundQuoteKey(quote.cnpj, quote.subclassId);
					return {
						replaceOne: {
							filter: { _id },
							replacement: { _id, ...quote, sourceUrl, updatedAt },
							upsert: true,
						},
					};
				}),
				{ ordered: false }
			);
			written += fresh.length;
		}
		return written;
	}

	async findClass(cnpj: string): Promise<InvestmentFundClass | null> {
		const doc = await this.classes.findById(cnpj).lean().exec();
		return doc ? toClass(doc) : null;
	}

	async searchClasses(
		query: string,
		limit: number
	): Promise<InvestmentFundClass[]> {
		const digits = query.replace(/\D/g, '');
		const looksLikeCnpj = digits.length >= 6 && /^[\d./\-\s]+$/.test(query);
		const terms = searchTerms(query);
		if (!looksLikeCnpj && !terms.length) return [];

		const filter = looksLikeCnpj
			? { _id: { $regex: `^${digits}` } }
			: {
					$and: terms.map((term) => ({
						searchName: { $regex: escapeRegex(term) },
					})),
				};
		const docs = await this.classes
			.find(filter)
			.sort({ name: 1 })
			.limit(limit)
			.lean()
			.exec();
		return docs.map(toClass);
	}

	async findClassQuotes(cnpjs: string[]): Promise<StoredFundQuote[]> {
		if (!cnpjs.length) return [];
		const docs = await this.quotes
			.find({ _id: { $in: cnpjs } })
			.lean()
			.exec();
		return docs.map((doc) => ({
			cnpj: doc.cnpj,
			subclassId: doc.subclassId ?? null,
			date: doc.date,
			quota: doc.quota,
			netAssetValue: doc.netAssetValue ?? null,
			investorCount: doc.investorCount ?? null,
			sourceUrl: doc.sourceUrl,
		}));
	}

	countClasses(): Promise<number> {
		return this.classes.estimatedDocumentCount().exec();
	}

	async findIngestion(key: string): Promise<IngestionRecord | null> {
		const doc = await this.ingestions.findById(key).lean().exec();
		if (!doc) return null;
		return {
			key: doc._id,
			sourceUrl: doc.sourceUrl,
			sha256: doc.sha256,
			rows: doc.rows,
			latestDate: doc.latestDate ?? null,
			ingestedAt: doc.ingestedAt,
		};
	}

	async saveIngestion(record: IngestionRecord): Promise<void> {
		const { key, ...rest } = record;
		await this.ingestions
			.replaceOne({ _id: key }, { _id: key, ...rest }, { upsert: true })
			.exec();
	}
}
