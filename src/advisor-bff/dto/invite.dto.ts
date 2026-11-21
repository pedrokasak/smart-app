import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import type { PendingInviteSummary } from 'src/advisor/application/client-directory.service';

/**
 * O formato do e-mail e o tamanho do nome são regras do serviço
 * (`INVALID_EMAIL`, `INVALID_NAME`): aqui só se exige o tipo, para que o
 * `reason` chegue ao cliente pelo filtro do BFF.
 */
export class CreateInviteDto {
	@ApiProperty({ description: 'E-mail do convidado' })
	@IsString()
	email: string;

	@ApiProperty({ minLength: 1, maxLength: 120 })
	@IsString()
	clientName: string;
}

export class CreateInviteResponseDto {
	@ApiProperty()
	inviteId: string;

	@ApiProperty()
	clientProfileId: string;

	@ApiProperty({ type: String, format: 'date-time' })
	expiresAt: Date;

	static of(created: {
		inviteId: string;
		clientProfileId: string;
		expiresAt: Date;
	}): CreateInviteResponseDto {
		return {
			inviteId: created.inviteId,
			clientProfileId: created.clientProfileId,
			expiresAt: created.expiresAt,
		};
	}
}

export class ResendInviteResponseDto {
	@ApiProperty({ type: String, format: 'date-time' })
	expiresAt: Date;

	static of(resent: { expiresAt: Date }): ResendInviteResponseDto {
		return { expiresAt: resent.expiresAt };
	}
}

export class PendingInviteResponseDto {
	@ApiProperty()
	id: string;

	@ApiProperty()
	clientProfileId: string;

	@ApiProperty()
	clientName: string;

	@ApiProperty({ example: 'm***@e***.com', description: 'Sempre mascarado' })
	invitedEmailMasked: string;

	@ApiProperty({ type: String, format: 'date-time' })
	expiresAt: Date;

	@ApiProperty()
	resendCount: number;

	static of(invite: PendingInviteSummary): PendingInviteResponseDto {
		return {
			id: invite.id,
			clientProfileId: invite.clientProfileId,
			clientName: invite.clientName,
			invitedEmailMasked: invite.invitedEmailMasked,
			expiresAt: invite.expiresAt,
			resendCount: invite.resendCount,
		};
	}
}
