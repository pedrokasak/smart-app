import { Controller, Get, Query, Res } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Response } from 'express';
import { Public } from 'src/utils/constants';
import { User } from 'src/users/schema/user.model';
import { DigestUnsubscribeTokenService } from 'src/notifications/portfolio-digest/application/digest-unsubscribe-token.service';

/**
 * Um clique, sem login: o token do link já autoriza a ação (ver
 * DigestUnsubscribeTokenService). Rota pública de propósito — exigir login
 * pra sair de uma lista de e-mail é fricção que ninguém deveria enfrentar.
 */
@Controller('notifications/digest')
export class PortfolioDigestController {
	constructor(
		private readonly tokenService: DigestUnsubscribeTokenService,
		@InjectModel('User') private readonly userModel: Model<User>
	) {}

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
