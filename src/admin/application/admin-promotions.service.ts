import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { StripeService } from 'src/subscription/stripe.service';
import type { CreatePromotionDto } from '../dto/promotion.dto';

export interface PromotionView {
	id: string;
	code: string;
	percentOff: number | null;
	amountOff: number | null;
	duration: string;
	durationInMonths: number | null;
	timesRedeemed: number;
	maxRedemptions: number | null;
	expiresAt: string | null;
	active: boolean;
}

/**
 * Cupons do Stripe operados pelo admin (TRA-182). Stripe é a fonte de
 * verdade (CLAUDE.md §4.4): nada fica guardado aqui. Toda criação e
 * desativação vai para o log com quem fez, para auditoria.
 */
@Injectable()
export class AdminPromotionsService {
	private readonly logger = new Logger(AdminPromotionsService.name);

	constructor(private readonly stripe: StripeService) {}

	async create(
		dto: CreatePromotionDto,
		adminId: string
	): Promise<PromotionView> {
		if ((dto.percentOff === undefined) === (dto.amountOff === undefined)) {
			throw new BadRequestException(
				'Informe o desconto em % ou em reais, não os dois.'
			);
		}
		const promotion = await this.stripe.createPromotion({
			code: dto.code,
			percentOff: dto.percentOff,
			amountOffCents:
				dto.amountOff !== undefined
					? Math.round(dto.amountOff * 100)
					: undefined,
			duration: dto.duration,
			durationInMonths: dto.durationInMonths,
			maxRedemptions: dto.maxRedemptions,
			redeemBy: dto.redeemBy,
		});
		this.logger.log(
			`admin=${adminId} criou o cupom ${dto.code} (promotion ${promotion.id})`
		);
		return toView(promotion);
	}

	async list(): Promise<PromotionView[]> {
		return (await this.stripe.listPromotions()).map(toView);
	}

	async deactivate(id: string, adminId: string): Promise<PromotionView> {
		const promotion = await this.stripe.deactivatePromotion(id);
		this.logger.log(
			`admin=${adminId} desativou o cupom ${promotion.code} (${id})`
		);
		return toView(promotion);
	}
}

function toView(promotion: any): PromotionView {
	const coupon = typeof promotion.coupon === 'object' ? promotion.coupon : {};
	return {
		id: promotion.id,
		code: promotion.code,
		percentOff: coupon.percent_off ?? null,
		amountOff: coupon.amount_off != null ? coupon.amount_off / 100 : null,
		duration: coupon.duration ?? 'once',
		durationInMonths: coupon.duration_in_months ?? null,
		timesRedeemed: promotion.times_redeemed ?? 0,
		maxRedemptions: promotion.max_redemptions ?? null,
		expiresAt: promotion.expires_at
			? new Date(promotion.expires_at * 1000).toISOString()
			: null,
		active: !!promotion.active,
	};
}
