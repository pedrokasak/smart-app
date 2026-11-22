import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
	IsIn,
	IsInt,
	IsOptional,
	IsString,
	Matches,
	Max,
	Min,
} from 'class-validator';
import type { ClientSummary } from 'src/advisor/application/client-directory.service';
import { ProfileOrigin, RelationshipStatus } from 'src/advisor/domain/enums';

export const CLIENT_STATUS_FILTERS = ['OPEN', 'REVOKED'] as const;
export type ClientStatusFilter = (typeof CLIENT_STATUS_FILTERS)[number];

/** `me`, `none` ou um id de usuário do projeto (ObjectId, 24 hex). */
export const ASSIGNEE_FILTER_PATTERN = /^(me|none|[0-9a-fA-F]{24})$/;

export const MAX_PAGE_LIMIT = 100;
export const DEFAULT_PAGE_LIMIT = 50;

/** `cursor` e `limit` das listas paginadas do BFF. */
export class PageQueryDto {
	@ApiPropertyOptional({ description: 'Cursor opaco da página anterior' })
	@IsOptional()
	@IsString()
	cursor?: string;

	@ApiPropertyOptional({
		minimum: 1,
		maximum: MAX_PAGE_LIMIT,
		default: DEFAULT_PAGE_LIMIT,
	})
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(MAX_PAGE_LIMIT)
	limit?: number;
}

export class ListClientsQueryDto extends PageQueryDto {
	@ApiPropertyOptional({
		enum: CLIENT_STATUS_FILTERS,
		default: 'OPEN',
		description: 'OPEN = relações ACTIVE e PENDING; REVOKED = encerradas',
	})
	@IsOptional()
	@IsIn(CLIENT_STATUS_FILTERS)
	status?: ClientStatusFilter;

	@ApiPropertyOptional({
		pattern: ASSIGNEE_FILTER_PATTERN.source,
		description:
			'Só ORG_ADMIN: me, none (sem atribuição) ou o userId de um membro. Para o ADVISOR a lista já vem filtrada e o parâmetro é 400 ASSIGNEE_FILTER_FORBIDDEN',
	})
	@IsOptional()
	@IsString()
	@Matches(ASSIGNEE_FILTER_PATTERN)
	assignee?: string;
}

export class CreateClientDto {
	@ApiProperty({ minLength: 1, maxLength: 120 })
	@IsString()
	name: string;
}

export class ClientSummaryResponseDto {
	@ApiProperty()
	id: string;

	@ApiProperty()
	name: string;

	@ApiProperty({ enum: ProfileOrigin })
	origin: ProfileOrigin;

	@ApiProperty({ enum: RelationshipStatus })
	relationshipStatus: RelationshipStatus;

	@ApiProperty()
	hasSharedPortfolios: boolean;

	static of(summary: ClientSummary): ClientSummaryResponseDto {
		return {
			id: summary.id,
			name: summary.name,
			origin: summary.origin,
			relationshipStatus: summary.relationshipStatus,
			hasSharedPortfolios: summary.hasSharedPortfolios,
		};
	}
}

export class ClientPageResponseDto {
	@ApiProperty({ type: [ClientSummaryResponseDto] })
	items: ClientSummaryResponseDto[];

	@ApiProperty({ type: String, nullable: true })
	nextCursor: string | null;

	static of(page: {
		items: ClientSummary[];
		nextCursor: string | null;
	}): ClientPageResponseDto {
		return {
			items: page.items.map(ClientSummaryResponseDto.of),
			nextCursor: page.nextCursor,
		};
	}
}
