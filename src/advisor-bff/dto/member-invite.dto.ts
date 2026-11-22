import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import type {
	MemberInvitePreview,
	PendingMemberInvite,
} from 'src/advisor/application/member-invite.service';
import { AdvisorType, OrgRole } from 'src/advisor/domain/enums';

/**
 * O formato do e-mail é regra do serviço (`INVALID_EMAIL`): aqui só o tipo,
 * para o `reason` chegar ao cliente pelo filtro do BFF.
 */
export class CreateMemberInviteDto {
	@ApiProperty({ description: 'E-mail do convidado (entra como ADVISOR)' })
	@IsString()
	email: string;
}

export class CreateMemberInviteResponseDto {
	@ApiProperty()
	inviteId: string;

	@ApiProperty({ type: String, format: 'date-time' })
	expiresAt: Date;

	static of(created: {
		inviteId: string;
		expiresAt: Date;
	}): CreateMemberInviteResponseDto {
		return { inviteId: created.inviteId, expiresAt: created.expiresAt };
	}
}

export class PendingMemberInviteResponseDto {
	@ApiProperty()
	id: string;

	@ApiProperty({ example: 'fu***@ex***.com', description: 'Sempre mascarado' })
	emailMasked: string;

	@ApiProperty({ type: String, format: 'date-time' })
	expiresAt: Date;

	@ApiProperty()
	resendCount: number;

	@ApiProperty({ description: 'userId de quem convidou' })
	invitedBy: string;

	static of(invite: PendingMemberInvite): PendingMemberInviteResponseDto {
		return {
			id: invite.id,
			emailMasked: invite.emailMasked,
			expiresAt: invite.expiresAt,
			resendCount: invite.resendCount,
			invitedBy: invite.invitedBy,
		};
	}
}

/** O token real tem 43 caracteres (32 bytes em base64url). */
export const MEMBER_INVITE_TOKEN_MAX = 128;

/**
 * Token do link do e-mail, sempre no corpo. Só tipo e tamanho: qualquer
 * token que não serve (inválido, vencido, usado, de outro e-mail) é o mesmo
 * 404 do serviço, nunca um 400 que diga algo sobre ele.
 */
export class MemberInviteTokenDto {
	@ApiProperty({ minLength: 1, maxLength: MEMBER_INVITE_TOKEN_MAX })
	@IsString()
	@Length(1, MEMBER_INVITE_TOKEN_MAX)
	token: string;
}

/**
 * Query sem nenhum campo: com o `forbidNonWhitelisted` do ValidationPipe
 * global, `?token=` (ou qualquer outro) é 400. O token não vai na URL, que
 * fica em log de proxy e no histórico.
 */
export class NoQueryDto {}

export class MemberInvitePreviewResponseDto {
	@ApiProperty()
	organizationName: string;

	@ApiProperty({ enum: AdvisorType })
	advisorType: AdvisorType;

	@ApiProperty({ example: 'fu***@ex***.com', description: 'Sempre mascarado' })
	invitedEmailMasked: string;

	@ApiProperty({ type: String, format: 'date-time' })
	expiresAt: Date;

	static of(preview: MemberInvitePreview): MemberInvitePreviewResponseDto {
		return {
			organizationName: preview.organizationName,
			advisorType: preview.advisorType,
			invitedEmailMasked: preview.invitedEmailMasked,
			expiresAt: preview.expiresAt,
		};
	}
}

export class AcceptMemberInviteResponseDto {
	@ApiProperty({ description: 'Organização em que a conta entrou' })
	orgId: string;

	@ApiProperty({ enum: OrgRole })
	role: OrgRole;

	static of(joined: {
		orgId: string;
		role: OrgRole;
	}): AcceptMemberInviteResponseDto {
		return { orgId: joined.orgId, role: joined.role };
	}
}
