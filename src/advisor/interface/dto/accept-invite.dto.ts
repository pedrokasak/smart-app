import {
	ApiProperty,
	ApiPropertyOptional,
	IntersectionType,
} from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';
import { PortfolioIdsDto } from './change-shared-portfolios.dto';

/** 32 random bytes in base64url, no padding. */
export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Token of the invite e-mail: query of the preview, body of the writes. */
export class InviteTokenDto {
	@ApiProperty({ pattern: INVITE_TOKEN_PATTERN.source })
	@IsString()
	@Matches(INVITE_TOKEN_PATTERN)
	token: string;
}

/** Version of the consent text the investor read (YYYY-MM-DD). */
export const CONSENT_TEXT_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class AcceptInviteDto extends IntersectionType(
	InviteTokenDto,
	PortfolioIdsDto
) {
	@ApiPropertyOptional({ pattern: CONSENT_TEXT_VERSION_PATTERN.source })
	@IsOptional()
	@Matches(CONSENT_TEXT_VERSION_PATTERN)
	consentTextVersion?: string;
}
