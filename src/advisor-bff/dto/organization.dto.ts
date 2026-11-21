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

	static of(summary: OrganizationSummary): OrganizationResponseDto {
		return {
			id: summary.id,
			name: summary.name,
			advisorType: summary.advisorType,
			role: summary.role,
		};
	}
}
