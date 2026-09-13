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
};

export type ListManualGrantsResponse = {
	items: ManualGrantHistoryItem[];
	page: number;
	limit: number;
	total: number;
};
