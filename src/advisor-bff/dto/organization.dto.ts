import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString } from 'class-validator';
import type { OrganizationSummary } from 'src/advisor/application/organization.service';
import { AdvisorType, OrgRole } from 'src/advisor/domain/enums';

export class CreateOrganizationDto {
	@ApiProperty({ minLength: 2, maxLength: 120 })
	@IsString()
	name: string;

	@ApiProperty({ enum: AdvisorType })
	@IsEnum(AdvisorType)
	advisorType: AdvisorType;
}

export class OrganizationResponseDto {
	@ApiProperty()
	id: string;

	@ApiProperty()
	name: string;

	@ApiProperty({ enum: AdvisorType })
	advisorType: AdvisorType;

	@ApiProperty({ enum: OrgRole })
	role: OrgRole;

	static of(
		summary: Omit<OrganizationSummary, 'ownerUserId'>
	): OrganizationResponseDto {
		return {
			id: summary.id,
			name: summary.name,
			advisorType: summary.advisorType,
			role: summary.role,
		};
	}
}

/** Item de `GET /me/organizations`: a organização mais o estado do portal. */
export class MyOrganizationResponseDto extends OrganizationResponseDto {
	@ApiProperty({
		description:
			'O dono da organização tem acesso ao portal (plano ou liberação)',
	})
	portalActive: boolean;

	static withPortal(
		summary: OrganizationSummary,
		portalActive: boolean
	): MyOrganizationResponseDto {
		return { ...OrganizationResponseDto.of(summary), portalActive };
	}
}
