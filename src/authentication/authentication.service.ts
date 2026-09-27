import {
	Injectable,
	Logger,
	UnauthorizedException,
	NotFoundException,
	InternalServerErrorException,
	BadRequestException,
} from '@nestjs/common';
import { AuthenticateDto } from './dto/authenticate.dto';
import { JwtService } from '@nestjs/jwt';
import { AuthenticationEntity } from './entities/authentication-entity';
import { UserModel } from 'src/users/schema/user.model';
import { expireKeepAliveConected, googleClientId } from 'src/env';
import { AuthErrorService } from 'src/utils/errors-handler';
import { TokenBlacklistService } from 'src/token-blacklist/token-blacklist.service';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import * as crypto from 'crypto';
import { EmailService } from 'src/notifications/email/email.service';
import { authenticator } from 'otplib';
import { PasswordSecurityService } from 'src/authentication/security/password-security.service';
import {
	hashRefreshToken,
	isRefreshTokenDigest,
	matchesRefreshTokenDigest,
} from 'src/authentication/security/refresh-token-hash';
import { GoogleSigninDto } from 'src/authentication/dto/google-signin.dto';
import { INITIAL_ADMIN_EMAIL } from 'src/admin/constants/admin.constants';
import { Role } from 'src/auth/enums/role.enum';
import { BreachedPasswordPolicy } from 'src/authentication/application/breached-password.policy';
import {
	isWithinRotationGrace,
	remainingSessionSeconds,
	sessionTtl,
} from 'src/authentication/session/session-policy';

/**
 * Documento mínimo de usuário aceito por `issueSessionTokens`.
 *
 * Existe para que outros fluxos de login (ex.: 2FA) possam reaproveitar a
 * emissão de sessão sem depender do tipo completo do Mongoose.
 */
export interface SessionUser {
	id: string;
	email: string;
	firstName?: string;
	lastName?: string;
	refreshToken?: string | null;
	previousRefreshToken?: string | null;
	refreshTokenRotatedAt?: Date | null;
	lastLogin?: Date;
	lastSeenAt?: Date;
	save: () => Promise<unknown>;
	role?: string;
}

/** Par de tokens devolvido por todo fluxo de login. */
export interface SessionTokens {
	accessToken: string;
	refreshToken: string;
	expiresIn: string;
	user: {
		id: string;
		email: string;
		firstName?: string;
		lastName?: string;
		role: string;
	};
}

/** Opções de emissão de sessão. */
export interface SessionOptions {
	/** "Manter conectado": escolhe o prazo da sessão (TRA-245). */
	keepConnected?: boolean;
}

/** Resposta da renovação. `refreshToken` vem quando o token foi girado. */
export interface RefreshedSession {
	accessToken: string;
	refreshToken?: string;
	expiresIn: string;
}

/** Renovações dentro desta janela não regravam `lastSeenAt` (TRA-192). */
export const LAST_SEEN_THROTTLE_MS = 60 * 60 * 1000;

type GoogleTokenInfoResponse = {
	aud?: string;
	email?: string;
	email_verified?: string;
	given_name?: string;
	family_name?: string;
	name?: string;
	picture?: string;
};

@Injectable()
export class AuthenticationService {
	private readonly logger = new Logger(AuthenticationService.name);

	constructor(
		private jwtService: JwtService,
		private tokenBlacklistService: TokenBlacklistService,
		private readonly emailService: EmailService,
		private readonly passwordSecurityService: PasswordSecurityService,
		private readonly breachedPasswordPolicy: BreachedPasswordPolicy
	) {}

	async signin(
		createSigninDto: AuthenticateDto
	): Promise<AuthenticationEntity> {
		const { email, password, keepConnected } = createSigninDto;

		const verifyUser = await UserModel.findOne({ email })
			.select('+password')
			.exec();

		// E-mail inexistente e senha errada respondem igual (TRA-89).
		//
		// Antes, `handleUserNotFound` devolvia 404 com o e-mail na mensagem e
		// senha errada devolvia 401 — dava pra descobrir quem tem conta aqui
		// só olhando o status. E o caminho do usuário inexistente retornava
		// sem executar o Argon2, então mesmo com respostas iguais o tempo
		// entregava a diferença. Por isso a verificação roda contra um hash
		// descartável quando não há usuário: mesmo custo, mesma resposta.
		if (!verifyUser?.password) {
			await this.passwordSecurityService.verifyPassword(
				password,
				await this.dummyPasswordHash()
			);
			AuthErrorService.handleInvalidCredentials();
		}

		const isPasswordValid = await this.passwordSecurityService.verifyPassword(
			password,
			verifyUser.password
		);

		if (!isPasswordValid) {
			AuthErrorService.handleInvalidCredentials();
		}

		// Secure migration path: seamlessly rehash legacy bcrypt passwords using Argon2id.
		if (this.passwordSecurityService.needsRehash(verifyUser.password)) {
			verifyUser.password =
				await this.passwordSecurityService.hashPassword(password);
			await verifyUser.save();
		}

		// Se 2FA está habilitado, retorna um tempToken para verificação
		if (verifyUser.twoFactorEnabled) {
			return this.twoFactorChallenge(verifyUser.id, keepConnected);
		}

		return this.issueSessionTokens(verifyUser as any, { keepConnected });
	}

	/**
	 * Hash descartável usado só para gastar o mesmo tempo de verificação
	 * quando o e-mail não existe. Calculado uma vez e reaproveitado — gerar a
	 * cada tentativa custaria mais que verificar, invertendo a diferença de
	 * tempo que este método existe pra apagar.
	 */
	private dummyHashPromise: Promise<string> | null = null;

	private dummyPasswordHash(): Promise<string> {
		if (!this.dummyHashPromise) {
			this.dummyHashPromise = this.passwordSecurityService.hashPassword(
				crypto.randomBytes(32).toString('hex')
			);
		}
		return this.dummyHashPromise;
	}

	async googleSignin(payload: GoogleSigninDto): Promise<AuthenticationEntity> {
		const tokenInfo = await this.verifyGoogleIdToken(payload.idToken);
		const email = String(tokenInfo.email || '')
			.trim()
			.toLowerCase();
		const emailVerified =
			String(tokenInfo.email_verified || '').toLowerCase() === 'true';

		if (!email || !emailVerified) {
			throw new UnauthorizedException(
				'Conta Google inválida ou email não verificado'
			);
		}

		let user = await UserModel.findOne({ email }).select('+password').exec();
		if (!user) {
			const generatedPassword = crypto.randomBytes(24).toString('hex');
			const hashedPassword =
				await this.passwordSecurityService.hashPassword(generatedPassword);
			const [firstName, ...lastParts] = String(
				tokenInfo.given_name || tokenInfo.name || 'Usuário'
			)
				.trim()
				.split(/\s+/);
			const lastName = String(
				tokenInfo.family_name || lastParts.join(' ') || ''
			).trim();
			user = await UserModel.create({
				email,
				password: hashedPassword,
				firstName,
				lastName,
				avatar: tokenInfo.picture || undefined,
				isEmailVerified: true,
				role: email === INITIAL_ADMIN_EMAIL ? Role.Admin : Role.User,
			});
		} else {
			const updates: Record<string, unknown> = {};
			if (!user.firstName && tokenInfo.given_name) {
				updates.firstName = tokenInfo.given_name;
			}
			if (!user.lastName && tokenInfo.family_name) {
				updates.lastName = tokenInfo.family_name;
			}
			if (!user.avatar && tokenInfo.picture) {
				updates.avatar = tokenInfo.picture;
			}
			if (!user.isEmailVerified) {
				updates.isEmailVerified = true;
			}
			if (Object.keys(updates).length > 0) {
				await UserModel.updateOne({ _id: user._id }, { $set: updates }).exec();
				user = await UserModel.findById(user._id).select('+password').exec();
			}
		}

		if (!user) {
			throw new InternalServerErrorException('Falha ao autenticar com Google');
		}

		if (user.twoFactorEnabled) {
			return this.twoFactorChallenge(user.id, payload.keepConnected);
		}

		return this.issueSessionTokens(user as any, {
			keepConnected: payload.keepConnected,
		});
	}

	/**
	 * Login com 2FA devolve um tempToken em vez da sessão. A escolha de
	 * "Manter conectado" viaja nele (`keep`) até o código ser confirmado.
	 */
	private twoFactorChallenge(userId: string, keepConnected?: boolean) {
		const tempToken = this.jwtService.sign(
			{ userId, type: 'temp_2fa', keep: keepConnected === true },
			{ expiresIn: '5m' }
		);
		return { requiresTwoFactor: true, tempToken } as any;
	}

	async signout(token: string) {
		const verifyToken = this.jwtService.verify(token, {
			ignoreExpiration: true,
		});
		if (!verifyToken) {
			AuthErrorService.handleInvalidToken();
		}
		await this.tokenBlacklistService.addToBlacklist(token, verifyToken.exp);

		// Sair também encerra a renovação (TRA-245). Antes só o access token
		// ia para a blacklist e o refresh token seguia renovando por dias.
		if (verifyToken.userId) {
			await UserModel.updateOne(
				{ _id: verifyToken.userId },
				{
					$set: {
						refreshToken: null,
						previousRefreshToken: null,
						refreshTokenRotatedAt: null,
					},
				}
			).exec();
		}

		return { message: 'Signout successfully' };
	}

	private async verifyGoogleIdToken(
		idToken: string
	): Promise<GoogleTokenInfoResponse> {
		const response = await fetch(
			`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
			{
				method: 'GET',
				headers: {
					Accept: 'application/json',
				},
			}
		);
		if (!response.ok) {
			throw new UnauthorizedException('Token Google inválido');
		}

		const data = (await response.json()) as GoogleTokenInfoResponse;
		if (!data?.aud || !data?.email) {
			throw new UnauthorizedException('Token Google sem dados obrigatórios');
		}
		if (googleClientId && data.aud !== googleClientId) {
			throw new UnauthorizedException('Token Google com audience inválida');
		}
		return data;
	}

	/**
	 * Único ponto de emissão de sessão do backend (TRA-140).
	 *
	 * Público de propósito: o fluxo de 2FA (`TwoFactorService`) chama este
	 * mesmo método em vez de assinar e gravar os tokens por conta própria. O
	 * 2FA duplicava esta lógica e a cópia esqueceu do hash — gravava o refresh
	 * token em texto puro e, de quebra, emitia access token sem `role`. Manter
	 * uma emissão só elimina a origem da divergência em vez de remendá-la.
	 */
	async issueSessionTokens(
		user: SessionUser,
		options: SessionOptions = {}
	): Promise<SessionTokens> {
		const keepConnected = options.keepConnected === true;
		const accessToken = this.jwtService.sign(
			{
				userId: user.id,
				type: 'access',
				role: user.role ?? 'user',
			},
			{ expiresIn: expireKeepAliveConected }
		);

		const refreshToken = this.jwtService.sign(
			{ userId: user.id, type: 'refresh', keep: keepConnected },
			{ expiresIn: sessionTtl(keepConnected) }
		);

		// SHA-256, não Argon2 (TRA-143). Ver `refresh-token-hash.ts`: o token é
		// um JWT assinado e já validado por `jwtService.verify` antes desta
		// comparação; o hash serve para revogação/binding, não para resistir a
		// dicionário. Argon2 aqui custava 64 MiB por login sem ganho.
		user.refreshToken = hashRefreshToken(refreshToken);
		// Login novo começa sem histórico de rotação.
		user.previousRefreshToken = null;
		user.refreshTokenRotatedAt = null;
		// Sinal de atividade para a contagem do painel admin (TRA-192). Vai no
		// mesmo `save()` que já grava o refresh token: nenhuma escrita extra
		// no login. Todo fluxo de entrada (senha, Google, 2FA, recovery code)
		// passa por aqui.
		const now = new Date();
		user.lastLogin = now;
		user.lastSeenAt = now;
		await user.save();

		return {
			accessToken,
			refreshToken,
			expiresIn: String(expireKeepAliveConected),
			user: {
				id: user.id,
				email: user.email,
				firstName: user.firstName,
				lastName: user.lastName,
				role: user.role ?? Role.User,
			},
		};
	}

	/**
	 * Confere o refresh token recebido contra o valor gravado, aceitando os dois
	 * formatos durante a transição (TRA-143).
	 *
	 * Formato novo: digest SHA-256 hex, comparado em tempo constante.
	 * Formato legado: hash Argon2/bcrypt de sessões emitidas antes desta
	 * mudança, verificado pelo caminho antigo. Sessões legadas migram sozinhas
	 * para SHA-256 no próximo `issueSessionTokens` (todo login regrava o campo),
	 * então nenhuma sessão em curso é derrubada e nenhuma escrita extra entra no
	 * caminho quente do refresh.
	 */
	private async verifyStoredRefreshToken(
		refreshToken: string,
		storedValue: string
	): Promise<boolean> {
		if (isRefreshTokenDigest(storedValue)) {
			return matchesRefreshTokenDigest(refreshToken, storedValue);
		}

		return this.passwordSecurityService.verifyPassword(
			refreshToken,
			storedValue
		);
	}

	async signoutAll(userId: string) {
		const user = await UserModel.findById(userId);
		if (user) {
			user.refreshToken = null;
			await user.save();
		}

		return { message: 'All sessions signed out successfully' };
	}

	/**
	 * Renova o access token e gira o refresh token (TRA-245).
	 *
	 * - Token atual: devolve access token novo e um refresh token novo, que
	 *   herda o fim da sessão do anterior (girar não estica a sessão).
	 * - Token anterior, logo depois de uma rotação: aceito dentro da janela de
	 *   tolerância, só com access token — abas concorrentes já têm o novo.
	 * - Token anterior fora da janela: reuso. Alguém guardou um token que já
	 *   foi trocado; a sessão inteira cai.
	 */
	async refreshAccessToken(refreshToken: string): Promise<RefreshedSession> {
		try {
			const payload = this.jwtService.verify(refreshToken);

			if (payload.type !== 'refresh') {
				throw new Error('Invalid token type');
			}

			// `refreshToken` e `select: false` no schema: sem projetar explicitamente,
			// o campo volta undefined e TODA renovacao falha — para todo usuario, nao
			// so os de 2FA. Os testes nao pegavam porque mockavam `findById`
			// devolvendo o documento ja com o campo, formato que producao nunca tem.
			const user = await UserModel.findById(payload.userId).select(
				'+refreshToken +previousRefreshToken +refreshTokenRotatedAt'
			);
			if (!user || !user.refreshToken) {
				throw new Error('Invalid refresh token');
			}

			const isCurrent = await this.verifyStoredRefreshToken(
				refreshToken,
				user.refreshToken
			);
			let rotatedRefreshToken: string | undefined;

			if (isCurrent) {
				rotatedRefreshToken = await this.rotateRefreshToken(
					user.id,
					user.refreshToken,
					payload
				);
			} else if (!this.isGracefulReuse(refreshToken, user)) {
				await this.revokeOnReuse(user.id);
				throw new Error('Refresh token reuse');
			}

			const newAccessToken = this.jwtService.sign(
				{ userId: user.id, type: 'access', role: user.role ?? 'user' },
				{ expiresIn: expireKeepAliveConected }
			);

			await this.touchLastSeen(user.id);

			return {
				accessToken: newAccessToken,
				...(rotatedRefreshToken ? { refreshToken: rotatedRefreshToken } : {}),
				expiresIn: String(expireKeepAliveConected),
			};
		} catch (error) {
			throw new UnauthorizedException('Invalid or expired refresh token');
		}
	}

	/**
	 * Troca o refresh token gravado por um novo. A escrita só casa se o valor
	 * gravado ainda é o que foi conferido: se outra requisição girou antes,
	 * esta não sobrescreve e segue só com o access token.
	 */
	private async rotateRefreshToken(
		userId: string,
		storedValue: string,
		payload: { exp: number; keep?: boolean }
	): Promise<string | undefined> {
		const claims: Record<string, unknown> = { userId, type: 'refresh' };
		// Token emitido antes do TRA-245 não tem `keep`: o novo também não, e
		// herda o mesmo fim de sessão.
		if (typeof payload.keep === 'boolean') claims.keep = payload.keep;

		const next = this.jwtService.sign(claims, {
			expiresIn: remainingSessionSeconds(payload.exp),
		});

		const result = await UserModel.updateOne(
			{ _id: userId, refreshToken: storedValue },
			{
				$set: {
					refreshToken: hashRefreshToken(next),
					// Só o digest SHA-256 do anterior entra no histórico; um valor
					// legado (Argon2) não serve para a comparação da janela.
					previousRefreshToken: isRefreshTokenDigest(storedValue)
						? storedValue
						: null,
					refreshTokenRotatedAt: new Date(),
				},
			}
		).exec();

		return result.modifiedCount > 0 ? next : undefined;
	}

	private isGracefulReuse(
		refreshToken: string,
		user: {
			previousRefreshToken?: string | null;
			refreshTokenRotatedAt?: Date | null;
		}
	): boolean {
		return (
			!!user.previousRefreshToken &&
			isWithinRotationGrace(user.refreshTokenRotatedAt) &&
			matchesRefreshTokenDigest(refreshToken, user.previousRefreshToken)
		);
	}

	private async revokeOnReuse(userId: string): Promise<void> {
		this.logger.warn(
			`[auth] refresh token já girado reapresentado; sessão revogada (user ${userId}).`
		);
		await UserModel.updateOne(
			{ _id: userId },
			{
				$set: {
					refreshToken: null,
					previousRefreshToken: null,
					refreshTokenRotatedAt: null,
				},
			}
		).exec();
	}

	/**
	 * Marca atividade na renovação de sessão (TRA-192). Quem usa "manter
	 * conectado" não passa pelo login por semanas; sem isto ele nunca contaria
	 * como usuário ativo.
	 *
	 * A escrita é condicional e atômica: o filtro só casa se o último sinal
	 * tem mais de uma hora, então o refresh — que é caminho quente — escreve no
	 * máximo uma vez por hora por usuário, sem ler o documento antes.
	 *
	 * Nunca lança. Métrica de painel não pode derrubar a renovação de sessão
	 * do usuário.
	 */
	private async touchLastSeen(userId: string): Promise<void> {
		const now = new Date();
		const threshold = new Date(now.getTime() - LAST_SEEN_THROTTLE_MS);

		try {
			await UserModel.updateOne(
				{ _id: userId, lastSeenAt: { $not: { $gte: threshold } } },
				{ $set: { lastSeenAt: now } }
			).exec();
		} catch (error) {
			this.logger.warn(
				`Falha ao registrar atividade na renovação de sessão: ${
					(error as Error)?.message ?? 'erro desconhecido'
				}`
			);
		}
	}

	async updatePassword(
		userId: string,
		updatePasswordDto: UpdatePasswordDto
	): Promise<{ message: string }> {
		const user = await UserModel.findById(userId).select('+password');

		if (!user) {
			throw new NotFoundException('User not found');
		}
		if (!user.password) {
			throw new InternalServerErrorException(
				'Senha não configurada para este usuário'
			);
		}

		const isPasswordValid = await this.passwordSecurityService.verifyPassword(
			updatePasswordDto.oldPassword,
			user.password
		);

		if (!isPasswordValid) {
			throw new UnauthorizedException('Invalid old password');
		}

		// TRK-012. Depois de conferir a senha antiga: quem nao provou ser o
		// dono da conta nao deveria conseguir usar esta rota como oraculo
		// para descobrir se uma senha qualquer esta em vazamento.
		await this.breachedPasswordPolicy.assertNotBreached(
			updatePasswordDto.newPassword
		);

		const hashedPassword = await this.passwordSecurityService.hashPassword(
			updatePasswordDto.newPassword
		);

		user.password = hashedPassword;
		// Mesma razão do resetPassword: trocar a senha encerra as sessões
		// anteriores (TRA-89).
		user.refreshToken = null;
		await user.save();

		await this.notifyPasswordChanged(user);

		return { message: 'Password updated successfully' };
	}

	/**
	 * Avisa o dono da conta que a senha mudou (TRA-191).
	 *
	 * Falha de e-mail nunca desfaz a troca — a senha já está gravada quando
	 * isto roda, e derrubar a requisição aqui faria o usuário achar que a
	 * troca não aconteceu e tentar de novo com a senha antiga, que já não
	 * vale mais.
	 */
	private async notifyPasswordChanged(user: {
		email?: string;
		firstName?: string;
		id?: string;
	}): Promise<void> {
		if (!user?.email) return;

		try {
			await this.emailService.sendPasswordChangedEmail(
				user.email,
				user.firstName
			);
		} catch (error) {
			this.logger.error(
				`Falha ao enviar aviso de senha alterada (userId=${user.id}): ${error?.message}. ` +
					'A senha FOI alterada; o usuário não recebeu o aviso.'
			);
		}
	}

	async forgotPassword(
		forgotPasswordDto: ForgotPasswordDto
	): Promise<{ message: string }> {
		const user = await UserModel.findOne({ email: forgotPasswordDto.email });

		if (!user) {
			// Do not reveal that a user does not exist
			return {
				message: 'If the email is valid, a password reset link has been sent',
			};
		}

		// Generate token
		const resetToken = crypto.randomBytes(32).toString('hex');
		const hash = crypto.createHash('sha256').update(resetToken).digest('hex');

		// Set expiration (1 hour)
		const resetPasswordExpires = new Date();
		resetPasswordExpires.setHours(resetPasswordExpires.getHours() + 1);

		user.resetPasswordToken = hash;
		user.resetPasswordExpires = resetPasswordExpires;
		await user.save();

		// A resposta segue genérica mesmo quando o envio falha: variar o retorno
		// entre "enviado" e "erro" revelaria quais e-mails existem, porque o
		// caminho de e-mail inexistente retorna antes daqui e nunca falharia.
		//
		// O que estava errado era o `catch` VAZIO (TRA-151): uma queda total do
		// provedor não deixava rastro nenhum no ponto de negócio, e recuperação
		// de senha — o único caminho de volta de quem perdeu o acesso — falhava
		// em silêncio. Resposta genérica para o usuário, ERROR para quem opera.
		//
		// Loga `user._id` em vez do e-mail: log de erro não precisa carregar
		// dado pessoal para ser acionável (CLAUDE.md §8).
		try {
			await this.emailService.sendPasswordResetEmail(user.email, resetToken);
		} catch (error) {
			this.logger.error(
				`Falha ao enviar e-mail de recuperação de senha (userId=${user._id}): ` +
					`${(error as Error)?.message ?? 'erro desconhecido'}. ` +
					`O usuário recebeu a resposta genérica e NÃO tem como redefinir a senha.`
			);
		}

		return {
			message: 'If the email is valid, a password reset link has been sent',
		};
	}

	async verifyResetToken(
		token: string
	): Promise<{ valid: boolean; requiresMfa: boolean }> {
		const hash = crypto.createHash('sha256').update(token).digest('hex');

		const user = await UserModel.findOne({
			resetPasswordToken: hash,
		}).select('+resetPasswordToken +resetPasswordExpires +twoFactorEnabled');

		if (!user) {
			throw new UnauthorizedException('Token inválido');
		}

		if (!user.resetPasswordExpires || user.resetPasswordExpires <= new Date()) {
			throw new UnauthorizedException('Token expirado');
		}

		return { valid: true, requiresMfa: user.twoFactorEnabled };
	}

	async resetPassword(
		resetPasswordDto: ResetPasswordDto
	): Promise<{ message: string }> {
		const hash = crypto
			.createHash('sha256')
			.update(resetPasswordDto.token)
			.digest('hex');

		const user = await UserModel.findOne({
			resetPasswordToken: hash,
		}).select(
			'+resetPasswordToken +resetPasswordExpires +password +twoFactorSecret'
		);

		if (!user) {
			throw new UnauthorizedException('Token inválido');
		}

		if (!user.resetPasswordExpires || user.resetPasswordExpires <= new Date()) {
			throw new UnauthorizedException('Token expirado');
		}

		if (resetPasswordDto.newPassword !== resetPasswordDto.confirmPassword) {
			throw new BadRequestException('As senhas não correspondem');
		}

		// Verify MFA if enabled
		if (user.twoFactorEnabled) {
			if (!resetPasswordDto.tfCode) {
				throw new UnauthorizedException(
					'Código de autenticação de dois fatores é obrigatório'
				);
			}

			const isCodeValid = authenticator.verify({
				token: resetPasswordDto.tfCode,
				secret: user.twoFactorSecret,
			});

			if (!isCodeValid) {
				throw new UnauthorizedException('Código de dois fatores inválido');
			}
		}

		// TRK-012. Depois do token e do 2FA, pela mesma razao do
		// `updatePassword`: a checagem so roda para quem ja provou ter direito
		// de trocar a senha desta conta.
		await this.breachedPasswordPolicy.assertNotBreached(
			resetPasswordDto.newPassword
		);

		const hashedPassword = await this.passwordSecurityService.hashPassword(
			resetPasswordDto.newPassword
		);

		user.password = hashedPassword;
		user.resetPasswordToken = undefined;
		user.resetPasswordExpires = undefined;
		// Derruba a sessão existente (TRA-89). Quem redefine a senha
		// normalmente o faz porque suspeita que alguém entrou na conta —
		// manter o refresh token anterior válido deixava esse alguém dentro.
		user.refreshToken = null;
		await user.save();

		await this.notifyPasswordChanged(user);

		return { message: 'Senha redefinida com sucesso' };
	}
}
