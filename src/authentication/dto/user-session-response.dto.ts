import { ApiProperty } from '@nestjs/swagger';
import {
	USER_SESSION_PLATFORMS,
	UserSessionPlatform,
} from 'src/authentication/session/user-session.repository';

/** Sessão como o dono da conta a vê. Nunca inclui digest de token. */
export class UserSessionResponseDto {
	@ApiProperty()
	id: string;

	@ApiProperty({ type: String, nullable: true })
	deviceName: string | null;

	@ApiProperty({ enum: USER_SESSION_PLATFORMS })
	platform: UserSessionPlatform;

	@ApiProperty()
	createdAt: Date;

	@ApiProperty()
	lastSeenAt: Date;

	@ApiProperty({ description: 'Sessão do token usado nesta requisição' })
	current: boolean;
}
