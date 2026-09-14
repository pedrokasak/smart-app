import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
	UpcomingDividend,
	UpcomingDividendPaymentType,
} from './upcoming-dividend.model';

export type UpcomingDividendInput = {
	symbol: string;
	name?: string;
	paymentType: UpcomingDividendPaymentType;
	expectedPaymentDate: Date;
	quantity: number;
	unitValue: number;
	netValue: number;
	institution?: string;
};

export type UpcomingDividendsSummary = {
	windowDays: number;
	totalNetValue: number;
	items: {
		id: string;
		portfolioId: string;
		symbol: string;
		name?: string;
		paymentType: UpcomingDividendPaymentType;
		expectedPaymentDate: Date;
		quantity: number;
		unitValue: number;
		netValue: number;
	}[];
};

const MAX_WINDOW_DAYS = 366;

const startOfUtcDay = (date: Date) =>
	new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
	);

@Injectable()
export class UpcomingDividendsService {
	constructor(
		@InjectModel('UpcomingDividend')
		private readonly upcomingDividendModel: Model<UpcomingDividend>
	) {}

	/**
	 * O relatório de Eventos é uma foto de TUDO que está pendente no dia em
	 * que foi baixado: o que saiu da lista foi pago ou cancelado. Por isso a
	 * importação substitui os pendentes da carteira em vez de somar —
	 * reimportar todo mês nunca duplica, e o que já foi pago some da lista
	 * (o pagamento real entra pelo extrato de movimentação).
	 */
	async replaceForPortfolio(
		userId: string,
		portfolioId: string,
		events: UpcomingDividendInput[],
		importedAt = new Date()
	) {
		const owner = {
			userId: new Types.ObjectId(userId),
			portfolioId: new Types.ObjectId(portfolioId),
		};

		await this.upcomingDividendModel.deleteMany(owner);
		if (events.length) {
			await this.upcomingDividendModel.insertMany(
				events.map((event) => ({
					...owner,
					...event,
					symbol: event.symbol.toUpperCase(),
					source: 'b3_events',
					importedAt,
				}))
			);
		}

		return {
			eventsImported: events.length,
			totalNetValue: roundCurrency(
				events.reduce((sum, event) => sum + event.netValue, 0)
			),
			nextPaymentDate: events.length
				? new Date(
						Math.min(...events.map((e) => e.expectedPaymentDate.getTime()))
					)
				: null,
		};
	}

	async listUpcoming(
		userId: string,
		portfolioIds: string[],
		windowDays: number,
		now = new Date()
	): Promise<UpcomingDividendsSummary> {
		const days = Math.min(
			Math.max(1, Math.floor(windowDays) || 45),
			MAX_WINDOW_DAYS
		);
		const from = startOfUtcDay(now);
		const to = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);

		if (!portfolioIds.length) {
			return { windowDays: days, totalNetValue: 0, items: [] };
		}

		const records = await this.upcomingDividendModel
			.find({
				userId: new Types.ObjectId(userId),
				portfolioId: { $in: portfolioIds.map((id) => new Types.ObjectId(id)) },
				expectedPaymentDate: { $gte: from, $lte: to },
			})
			.sort({ expectedPaymentDate: 1, symbol: 1 })
			.lean();

		const items = records.map((record: any) => ({
			id: String(record._id),
			portfolioId: String(record.portfolioId),
			symbol: record.symbol,
			name: record.name,
			paymentType: record.paymentType,
			expectedPaymentDate: record.expectedPaymentDate,
			quantity: Number(record.quantity || 0),
			unitValue: Number(record.unitValue || 0),
			netValue: Number(record.netValue || 0),
		}));

		return {
			windowDays: days,
			totalNetValue: roundCurrency(
				items.reduce((sum, item) => sum + item.netValue, 0)
			),
			items,
		};
	}
}

function roundCurrency(value: number) {
	return Math.round(value * 100) / 100;
}
