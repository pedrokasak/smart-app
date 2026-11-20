import { ApiProperty, IntersectionType } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
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

export class AcceptInviteDto extends IntersectionType(
	InviteTokenDto,
	PortfolioIdsDto
) {}
