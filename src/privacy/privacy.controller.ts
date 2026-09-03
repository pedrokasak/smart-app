import {
	Controller,
	Delete,
	ForbiddenException,
	Get,
	Req,
	UseGuards,
} from '@nestjs/common';
import {
	ApiBearerAuth,
	ApiOperation,
	ApiResponse,
	ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { PrivacyService } from './privacy.service';

function requireAuthenticatedUserId(req: any): string {
	const userId =
		req.user?.userId || req.user?.sub || req.user?._id || req.user?.id;
	if (!userId) {
		throw new ForbiddenException('Usuário não autenticado.');
	}
	return String(userId);
}

function extractBearerToken(req: any): string | undefined {
	const header = req.headers?.authorization;
	if (!header || !header.startsWith('Bearer ')) return undefined;
	return header.slice('Bearer '.length);
}

/**
 * Direitos LGPD básicos sobre a própria conta (TRA-122): exportação de
 * dados e exclusão de conta. Ambas as rotas só operam sobre o usuário do
 * token — não existe variante "por id" aqui, de propósito, para não abrir
 * uma via de admin apagar/exportar dados de terceiros sem passar pelo
 * fluxo administrativo já existente em `UsersController`.
 */
@Controller('privacy')
@ApiTags('privacy')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class PrivacyController {
	constructor(private readonly privacyService: PrivacyService) {}

	@Get('export')
	@ApiOperation({
		summary: 'Exporta todos os dados do usuário autenticado (LGPD)',
	})
	@ApiResponse({ status: 200, description: 'Dados do usuário' })
	async exportMyData(@Req() req: any) {
		const userId = requireAuthenticatedUserId(req);
		return this.privacyService.exportUserData(userId);
	}

	@Delete('account')
	@ApiOperation({
		summary: 'Exclui a própria conta do usuário autenticado (LGPD)',
	})
	@ApiResponse({ status: 200, description: 'Conta removida com sucesso' })
	async deleteMyAccount(@Req() req: any) {
		const userId = requireAuthenticatedUserId(req);
		const token = extractBearerToken(req);
		return this.privacyService.deleteOwnAccount(userId, token);
	}
}
