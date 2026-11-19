import {
	Controller,
	Delete,
	Get,
	HttpCode,
	NotFoundException,
	Param,
	Request,
	UseGuards,
} from '@nestjs/common';
import {
	ApiBearerAuth,
	ApiNoContentResponse,
	ApiNotFoundResponse,
	ApiOkResponse,
	ApiTags,
} from '@nestjs/swagger';
import { OwnershipChecked } from 'src/auth/decorators/ownership.decorator';
import { UserSessionResponseDto } from 'src/authentication/dto/user-session-response.dto';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { UserSessionService } from './user-session.service';

/** Sessões da própria conta. O dono vem sempre do token, nunca da requisição. */
@Controller('auth/sessions')
@ApiTags('authentication')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class UserSessionsController {
	constructor(private readonly sessions: UserSessionService) {}

	@Get()
	@ApiOkResponse({ type: UserSessionResponseDto, isArray: true })
	async list(@Request() req): Promise<UserSessionResponseDto[]> {
		const sessions = await this.sessions.listForUser(req.user.userId);
		return sessions.map((session) => ({
			...session,
			current: session.id === req.user.sid,
		}));
	}

	@Delete(':sid')
	@OwnershipChecked('UserSessionService.revoke filtra sid pelo userId do token')
	@HttpCode(204)
	@ApiNoContentResponse({ description: 'Sessão encerrada' })
	@ApiNotFoundResponse({ description: 'Sessão inexistente ou de outra conta' })
	async revoke(@Request() req, @Param('sid') sid: string): Promise<void> {
		const revoked = await this.sessions.revoke(
			sid,
			req.user.userId,
			'user_request'
		);
		if (!revoked) throw new NotFoundException('Sessão não encontrada');
	}
}
