import { ApiProperty } from '@nestjs/swagger';
import type { ClientAssignee } from 'src/advisor/application/assignment.service';
import type { TeamMember } from 'src/advisor/application/team.service';
import { OrgRole } from 'src/advisor/domain/enums';

export class TeamMemberResponseDto {
	@ApiProperty()
	userId: string;

	@ApiProperty()
	name: string;

	@ApiProperty({ example: 'fu***@es***.com', description: 'Sempre mascarado' })
	emailMasked: string;

	@ApiProperty({ enum: OrgRole })
	role: OrgRole;

	@ApiProperty({ type: String, format: 'date-time' })
	joinedAt: Date;

	@ApiProperty({ description: 'Dono da organização: não sai nem é removido' })
	isOwner: boolean;

	static of(member: TeamMember): TeamMemberResponseDto {
		return {
			userId: member.userId,
			name: member.name,
			emailMasked: member.emailMasked,
			role: member.role,
			joinedAt: member.joinedAt,
			isOwner: member.isOwner,
		};
	}
}

export class PromoteMemberResponseDto {
	@ApiProperty()
	userId: string;

	@ApiProperty({ enum: OrgRole })
	role: OrgRole;
}

export class ClientAssigneeResponseDto {
	@ApiProperty()
	userId: string;

	@ApiProperty()
	name: string;

	static of(assignee: ClientAssignee): ClientAssigneeResponseDto {
		return { userId: assignee.userId, name: assignee.name };
	}
}
