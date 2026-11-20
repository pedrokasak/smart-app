import { ApiProperty } from '@nestjs/swagger';
import { AccessGrant, InvitePreview } from '../../application/consent.service';
import { AdvisorType } from '../../domain/enums';

export class OwnedPortfolioResponseDto {
	@ApiProperty()
	id: string;

	@ApiProperty()
	name: string;
}

export class InvitePreviewResponseDto {
	@ApiProperty()
	organizationName: string;

	@ApiProperty({ enum: AdvisorType })
	advisorType: AdvisorType;

	@ApiProperty({ example: 'jo***@ex***.com' })
	invitedEmailMasked: string;

	@ApiProperty({ type: String, format: 'date-time' })
	expiresAt: Date;

	@ApiProperty({ type: [OwnedPortfolioResponseDto] })
	portfolios: OwnedPortfolioResponseDto[];

	@ApiProperty()
	consentTextVersion: string;

	static of(preview: InvitePreview): InvitePreviewResponseDto {
		return {
			organizationName: preview.organizationName,
			advisorType: preview.advisorType,
			invitedEmailMasked: preview.invitedEmailMasked,
			expiresAt: preview.expiresAt,
			portfolios: preview.portfolios.map((p) => ({ id: p.id, name: p.name })),
			consentTextVersion: preview.consentTextVersion,
		};
	}
}

export class AccessGrantResponseDto {
	@ApiProperty({ format: 'uuid' })
	relationshipId: string;

	@ApiProperty()
	organizationName: string;

	@ApiProperty({ enum: AdvisorType })
	advisorType: AdvisorType;

	@ApiProperty({ type: [String] })
	portfolioIds: string[];

	@ApiProperty({ type: String, format: 'date-time' })
	grantedAt: Date;

	@ApiProperty()
	consentVersion: number;

	static of(grant: AccessGrant): AccessGrantResponseDto {
		return {
			relationshipId: grant.relationshipId,
			organizationName: grant.organizationName,
			advisorType: grant.advisorType,
			portfolioIds: [...grant.portfolioIds],
			grantedAt: grant.grantedAt,
			consentVersion: grant.consentVersion,
		};
	}
}
