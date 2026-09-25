import {
	Body,
	Controller,
	Get,
	Patch,
	Query,
	Req,
	Res,
	UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Response } from 'express';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { Public } from 'src/utils/constants';
import { User } from 'src/users/schema/user.model';
import { DigestUnsubscribeTokenService } from 'src/notifications/portfolio-digest/application/digest-unsubscribe-token.service';
import { UpdateDigestPreferenceDto } from 'src/notifications/portfolio-digest/dto/update-digest-preference.dto';

/** O payload do JWT variou entre versoes; aceita as formas ja emitidas. */
function resolveUserId(req: any): string {
	return String(
		req?.user?.userId ?? req?.user?.sub ?? req?.user?._id ?? req?.user?.id ?? ''
	);
}

/**
 * Preferência de resumo semanal de carteira por e-mail.
 *
 * TRA-202: o pipeline de envio (scheduler, builder, narrador por IA, e-mail)
 * sempre existiu, mas o único endpoint aqui era o de SAIR (unsubscribe, por
 * link, sem login). Não havia nenhuma forma de ligar — o campo nasce
 * `false` no schema e nada além do unsubscribe escrevia nele. Resultado:
 * ninguém, em nenhum plano, jamais conseguiu ativar a feature.
 */
@Controller('notifications/digest')
@ApiTags('Notifications')
export class PortfolioDigestController {
	constructor(
		private readonly tokenService: DigestUnsubscribeTokenService,
		@InjectModel('User') private readonly userModel: Model<User>
	) {}

	@Get('preferences')
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth('access-token')
	@ApiOperation({ summary: 'Estado atual da preferência de resumo semanal' })
	async getPreference(@Req() req: any): Promise<{ enabled: boolean }> {
		const user = await this.userModel
			.findById(resolveUserId(req))
			.select('notificationPreferences.portfolioDigest.enabled');
		return {
			enabled: user?.notificationPreferences?.portfolioDigest?.enabled ?? false,
		};
	}

	@Patch('preferences')
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth('access-token')
	@ApiOperation({ summary: 'Liga ou desliga o resumo semanal de carteira' })
	async updatePreference(
		@Req() req: any,
		@Body() dto: UpdateDigestPreferenceDto
	): Promise<{ enabled: boolean }> {
		const userId = resolveUserId(req);
		await this.userModel.findByIdAndUpdate(userId, {
			$set: {
				'notificationPreferences.portfolioDigest.enabled': dto.enabled,
				'notificationPreferences.portfolioDigest.updatedAt': new Date(),
			},
		});
		return { enabled: dto.enabled };
	}

	@Public()
	@Get('unsubscribe')
	async unsubscribe(
		@Query('token') token: string,
		@Res() res: Response
	): Promise<void> {
		const payload = this.tokenService.verify(token || '');
		if (!payload) {
			res
				.status(400)
				.type('text/plain')
				.send('Link inválido ou expirado. Ajuste a preferência direto no app.');
			return;
		}

		await this.userModel.findByIdAndUpdate(payload.userId, {
			$set: {
				'notificationPreferences.portfolioDigest.enabled': false,
				'notificationPreferences.portfolioDigest.updatedAt': new Date(),
			},
		});

		res
			.status(200)
			.type('text/plain')
			.send('Pronto — você não vai mais receber o resumo semanal de carteira.');
	}
}
