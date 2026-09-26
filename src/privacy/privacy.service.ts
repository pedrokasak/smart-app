import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AccountErasureService } from './account-erasure.service';
import { JwtService } from '@nestjs/jwt';
import { Model } from 'mongoose';
import { TradeDocument } from 'src/fiscal/schema/trade.model';
import { UsersService } from 'src/users/users.service';
import { ProfileService } from 'src/profile/profile.service';
import { AddressService } from 'src/address/address.service';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { SubscriptionService } from 'src/subscription/subscription.service';
import { TokenBlacklistService } from 'src/token-blacklist/token-blacklist.service';

@Injectable()
export class PrivacyService {
	private readonly logger = new Logger(PrivacyService.name);

	constructor(
		@InjectModel('Trade') private readonly tradeModel: Model<TradeDocument>,
		private readonly usersService: UsersService,
		private readonly profileService: ProfileService,
		private readonly addressService: AddressService,
		private readonly portfolioService: PortfolioService,
		private readonly subscriptionService: SubscriptionService,
		private readonly tokenBlacklistService: TokenBlacklistService,
		private readonly jwtService: JwtService,
		private readonly accountErasure: AccountErasureService
	) {}

	/**
	 * Exportação síncrona dos dados do titular (LGPD, TRA-122).
	 *
	 * Cada seção é buscada de forma independente e tolerante a ausência —
	 * um usuário pode não ter perfil, endereço ou assinatura ainda, e isso
	 * não pode derrubar a exportação inteira.
	 */
	async exportUserData(userId: string) {
		const [user, profile, addresses, portfolios, trades, subscription] =
			await Promise.all([
				this.usersService.findOne(userId),
				this.profileService.findOne(userId).catch(() => null),
				this.addressService.findByUserId(userId).catch(() => []),
				this.portfolioService.getUserPortfolios(userId).catch(() => []),
				this.tradeModel.find({ userId }).lean().exec(),
				this.subscriptionService.findUserSubscription(userId).catch(() => null),
			]);

		if (!user) {
			throw new NotFoundException('Usuário não encontrado');
		}

		const userObj: any =
			typeof (user as any).toObject === 'function'
				? (user as any).toObject()
				: user;
		// Dados sensíveis de autenticação nunca entram na exportação, mesmo
		// hasheados.
		delete userObj.password;
		delete userObj.refreshToken;
		delete userObj.resetPasswordToken;
		delete userObj.resetPasswordExpires;
		delete userObj.twoFactorSecret;

		return {
			generatedAt: new Date().toISOString(),
			account: userObj,
			profile: profile ?? null,
			addresses: addresses ?? [],
			portfolios: portfolios ?? [],
			transactions: trades ?? [],
			subscription: subscription ?? null,
		};
	}

	/**
	 * Exclusão da própria conta (LGPD, TRA-122/TRA-213): encerra a cobrança,
	 * apaga dado pessoal e credenciais de corretora e, por fim, o `User` e a
	 * cópia no RAG. Registro fiscal segue a decisão de retenção do TRA-127.
	 */
	async deleteOwnAccount(userId: string, bearerToken?: string) {
		this.logger.warn(
			`Exclusão de conta solicitada pelo próprio usuário: ${userId}`
		);

		const exists = await this.usersService.findOne(userId);
		if (!exists) {
			throw new NotFoundException('Usuário não encontrado');
		}
		await this.accountErasure.eraseDependents(userId);

		const deleted = await this.usersService.delete(userId);
		if (!deleted) {
			throw new NotFoundException('Usuário não encontrado');
		}

		// Derruba a sessão atual imediatamente. Best-effort: um token
		// ausente/expirado/inválido não pode impedir a exclusão da conta,
		// que já aconteceu no passo acima.
		if (bearerToken) {
			try {
				const decoded: any = this.jwtService.verify(bearerToken, {
					ignoreExpiration: true,
				});
				if (decoded?.exp) {
					await this.tokenBlacklistService.addToBlacklist(
						bearerToken,
						decoded.exp
					);
				}
			} catch (error) {
				this.logger.warn(
					`Não foi possível invalidar o token após exclusão de conta: ${
						(error as any)?.message || 'erro desconhecido'
					}`
				);
			}
		}

		return { message: 'Conta removida com sucesso.' };
	}
}
