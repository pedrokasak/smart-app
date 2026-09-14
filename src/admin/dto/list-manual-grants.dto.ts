import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListManualGrantsQueryDto {
	@ApiPropertyOptional({ default: 1, minimum: 1 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	page?: number = 1;

	@ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(100)
	limit?: number = 20;
}

export type ManualGrantHistoryItem = {
	id: string;
	userEmail: string;
	planId: string;
	planName: string;
	grantType: string;
	trialDurationDays?: number;
	discountPercent?: number;
	notes?: string;
	performedByEmail: string;
	createdAt: Date;
	/** Status da assinatura atual do usuário no momento da consulta —
	 * 'active'/'trialing' com currentPeriodEnd no futuro, ou 'expired'
	 * (sem assinatura ativa, cancelada, ou período expirado). */
	status: 'active' | 'expired';
};

export type ListManualGrantsResponse = {
	items: ManualGrantHistoryItem[];
	page: number;
	limit: number;
	total: number;
};
