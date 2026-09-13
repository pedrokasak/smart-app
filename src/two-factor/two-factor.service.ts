import {
	BadRequestException,
	Injectable,
	UnauthorizedException,
} from '@nestjs/common';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { UserModel } from 'src/users/schema/user.model';
import { JwtService } from '@nestjs/jwt';
import { jwtSecret } from 'src/env';
import {
	AuthenticationService,
	SessionTokens,
	SessionUser,
} from 'src/authentication/authentication.service';
import { TokenBlacklistService } from 'src/token-blacklist/token-blacklist.service';
import {
	TwoFactorAttemptState,
	clearedAttemptState,
	hasReachedLimit,
	isTwoFactorBlocked,
	readAttemptState,
	registerFailedAttempt,
} from './security/two-factor-attempt-policy';
import {
	RecoveryCodesSummary,
	StoredRecoveryCode,
	findUsableRecoveryCodeHash,
	generateRecoveryCodes,
	summarizeRecoveryCodes,
	toStoredRecoveryCodes,
} from './security/recovery-codes';

@Injectable()
export class TwoFactorService {
	constructor(
		private jwtService: JwtService,
		private readonly authenticationService: AuthenticationService,
		private readonly tokenBlacklistService: TokenBlacklistService
	) {}

	/**
	 * Gera um segredo TOTP para o usuário e retorna a URL do QR Code em base64.
	 * O segredo não é salvo ainda — só é salvo quando o usuário verificar o código.
	 */
	async setupTwoFactor(
		userId: string
	): Promise<{ secret: string; qrCodeDataUrl: string }> {
		const user = await UserModel.findById(userId);
		if (!user) throw new BadRequestException('Usuário não encontrado.');

		const secret = authenticator.generateSecret();
		const appName = 'Trackerr';
		const otpAuthUrl = authenticator.keyuri(user.email, appName, secret);
		const qrCodeDataUrl = await QRCode.toDataURL(otpAuthUrl);

		// Salva o segredo temporariamente (confirmação só após verify)
		await UserModel.findByIdAndUpdate(userId, {
			$set: { twoFactorSecret: secret, twoFactorEnabled: false },
		});

		return { secret, qrCodeDataUrl };
	}

	/**
	 * Verifica o código TOTP e habilita o 2FA para o usuário.
	 */
	async enableTwoFactor(
		userId: string,
		code: string
	): Promise<{ message: string }> {
		const user = await UserModel.findById(userId).select('+twoFactorSecret');
		if (!user || !user.twoFactorSecret) {
			throw new BadRequestException('Configure o 2FA primeiro.');
		}

		const isValid = authenticator.verify({
			token: code,
			secret: user.twoFactorSecret,
		});

		if (!isValid) {
			throw new UnauthorizedException('Código inválido ou expirado.');
		}

		await UserModel.findByIdAndUpdate(userId, { twoFactorEnabled: true });
		return { message: '2FA habilitado com sucesso!' };
	}

	/**
	 * Desabilita o 2FA do usuário após validar o código atual.
	 */
	async disableTwoFactor(
		userId: string,
		code: string
	): Promise<{ message: string }> {
		const user = await UserModel.findById(userId).select('+twoFactorSecret');
		if (!user || !user.twoFactorSecret || !user.twoFactorEnabled) {
			throw new BadRequestException('2FA não está habilitado.');
		}

		const isValid = authenticator.verify({
			token: code,
			secret: user.twoFactorSecret,
		});

		if (!isValid) {
			throw new UnauthorizedException('Código inválido ou expirado.');
		}

		await UserModel.findByIdAndUpdate(userId, {
			twoFactorEnabled: false,
			twoFactorSecret: null,
		});
		return { message: '2FA desabilitado com sucesso.' };
	}

	/**
	 * Autentica o código TOTP pós-login (quando 2FA está habilitado).
	 * Recebe o tempToken + código e emite a sessão final.
	 *
	 * A emissão é delegada a `AuthenticationService.issueSessionTokens`
	 * (TRA-140): é o mesmo caminho do login sem 2FA, então o refresh token sai
	 * daqui hasheado em SHA-256 como qualquer outro e o access token carrega o
	 * `role`. Antes este método assinava e gravava os tokens sozinho, e a cópia
	 * gravava `user.refreshToken` em texto puro — um bearer legível no banco
	 * que, ainda por cima, nunca casava com o verificador de `refreshAccessToken`.
	 */
	async authenticateWithTwoFactor(
		tempToken: string,
		code: string
	): Promise<SessionTokens> {
		const { payload, user, attemptState, now } =
			await this.openTwoFactorChallenge(tempToken);

		const isValid = authenticator.verify({
			token: code,
			secret: user.twoFactorSecret,
		});

		if (!isValid) {
			await this.registerFailure(user.id, attemptState, now, {
				tempToken,
				exp: payload.exp,
			});

			throw new UnauthorizedException('Código 2FA inválido ou expirado.');
		}

		// Acerto zera a contagem: a janela existe para conter automacao, nao
		// para punir quem digitou errado uma vez e acertou depois.
		await this.persistAttemptState(user.id, clearedAttemptState());

		return this.authenticationService.issueSessionTokens(
			user as unknown as SessionUser
		);
	}

	/**
	 * Gera um conjunto novo de códigos de recuperação.
	 *
	 * Exige o TOTP atual, não apenas a sessão. Um access token roubado não pode
	 * virar acesso permanente à conta imprimindo dez chaves de bypass do
	 * segundo fator: quem regenera tem que estar de posse do autenticador.
	 *
	 * O texto puro sai daqui uma única vez — o banco só recebe os digests.
	 */
	async generateRecoveryCodes(
		userId: string,
		code: string
	): Promise<{ codes: string[]; generatedAt: string }> {
		const user = await UserModel.findById(userId).select('+twoFactorSecret');
		if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
			throw new BadRequestException('2FA não está habilitado.');
		}

		const isValid = authenticator.verify({
			token: code,
			secret: user.twoFactorSecret,
		});

		if (!isValid) {
			throw new UnauthorizedException('Código inválido ou expirado.');
		}

		const codes = generateRecoveryCodes();
		const generatedAt = new Date();

		// Um `$set` só, com a lista inteira e o carimbo juntos: a substituição
		// do conjunto é atômica no documento. Não existe instante em que o
		// usuário fique sem códigos ou com metade dos antigos e metade dos
		// novos — o conjunto anterior deixa de valer exatamente quando o novo
		// passa a valer.
		await UserModel.updateOne(
			{ _id: userId },
			{
				$set: {
					twoFactorRecoveryCodes: toStoredRecoveryCodes(codes),
					twoFactorRecoveryCodesGeneratedAt: generatedAt,
				},
			}
		).exec();

		return { codes, generatedAt: generatedAt.toISOString() };
	}

	/**
	 * Quantos códigos ainda restam. Nunca devolve código nem hash: só o que a
	 * UI precisa para dizer "restam 7" e sugerir regenerar.
	 */
	async getRecoveryCodesStatus(userId: string): Promise<RecoveryCodesSummary> {
		const user = await UserModel.findById(userId).select(
			'+twoFactorRecoveryCodes +twoFactorRecoveryCodesGeneratedAt'
		);
		if (!user) {
			throw new BadRequestException('Usuário não encontrado.');
		}

		return summarizeRecoveryCodes(
			user.twoFactorRecoveryCodes as StoredRecoveryCode[],
			user.twoFactorRecoveryCodesGeneratedAt
		);
	}

	/**
	 * Consome um código de recuperação no lugar do TOTP.
	 *
	 * Mesma posição de `authenticateWithTwoFactor` — sem guard, porque neste
	 * ponto o usuário só tem o `tempToken` — e por isso mesmo passa pela mesma
	 * contagem de tentativas por usuário: um código de recuperação é um
	 * *bypass* do segundo fator, então não pode ter um orçamento de tentativas
	 * próprio e zerado. Quem gasta as 5 tentativas errando TOTP não ganha mais
	 * 5 trocando de endpoint.
	 */
	async consumeRecoveryCode(
		tempToken: string,
		recoveryCode: string
	): Promise<SessionTokens> {
		const { payload, user, attemptState, now } =
			await this.openTwoFactorChallenge(
				tempToken,
				'+twoFactorRecoveryCodes +twoFactorRecoveryCodesGeneratedAt'
			);

		const matchedHash = findUsableRecoveryCodeHash(
			(user.twoFactorRecoveryCodes as StoredRecoveryCode[]) ?? [],
			recoveryCode
		);

		// Um código consumido cai aqui junto com um código inexistente: a
		// resposta é a mesma, então ninguém descobre pela mensagem se acertou
		// um código que já tinha sido usado.
		const consumed = matchedHash
			? await this.markRecoveryCodeAsUsed(user.id, matchedHash, now)
			: false;

		if (!consumed) {
			await this.registerFailure(user.id, attemptState, now, {
				tempToken,
				exp: payload.exp,
			});

			throw new UnauthorizedException('Código de recuperação inválido.');
		}

		await this.persistAttemptState(user.id, clearedAttemptState());

		// O tempToken morre aqui. Sem isto, o mesmo token continuaria válido
		// pelo resto da janela de 5 minutos e serviria para uma segunda
		// tentativa de login — o código é de uso único, a autorização que ele
		// consumiu também precisa ser.
		await this.revokeTempToken(tempToken, payload.exp);

		return this.authenticationService.issueSessionTokens(
			user as unknown as SessionUser
		);
	}

	/**
	 * Carimba `usedAt` na entrada que casou, e só se ela ainda estiver livre.
	 *
	 * O filtro repete a condição "ainda não usada" dentro do próprio `update`
	 * de propósito: entre a leitura do documento e esta escrita cabe uma
	 * segunda requisição com o mesmo código. Deixar a decisão de uso único no
	 * processo Node seria confiar num read-modify-write sem trava; deixando-a
	 * no filtro do Mongo, a segunda escrita simplesmente não casa e
	 * `modifiedCount` volta 0. O uso único é do banco, não da aplicação.
	 *
	 * A entrada nunca é removida — `usedAt` preservado é o registro auditável
	 * de que aquele código específico foi gasto, e quando.
	 */
	private async markRecoveryCodeAsUsed(
		userId: string,
		hash: string,
		usedAt: Date
	): Promise<boolean> {
		const result = await UserModel.updateOne(
			{
				_id: userId,
				twoFactorRecoveryCodes: { $elemMatch: { hash, usedAt: null } },
			},
			{ $set: { 'twoFactorRecoveryCodes.$[entry].usedAt': usedAt } },
			{ arrayFilters: [{ 'entry.hash': hash, 'entry.usedAt': null }] }
		).exec();

		return (result?.modifiedCount ?? 0) > 0;
	}

	/**
	 * Preâmbulo comum aos dois caminhos sem guard (`authenticate` e
	 * `recovery-codes/consume`): valida o tempToken, carrega o usuário e
	 * aplica o bloqueio por tentativas ANTES de olhar para o que foi digitado.
	 *
	 * Existe para que os dois caminhos não possam divergir: uma segunda cópia
	 * desta sequência é exatamente o tipo de duplicação que esquece um passo —
	 * foi assim que o 2FA acabou emitindo sessão por fora de
	 * `issueSessionTokens` (TRA-140).
	 */
	private async openTwoFactorChallenge(
		tempToken: string,
		extraProjection = ''
	): Promise<{
		payload: { userId: string; type: string; exp?: number };
		user: any;
		attemptState: TwoFactorAttemptState;
		now: Date;
	}> {
		let payload: { userId: string; type: string; exp?: number };
		try {
			payload = this.jwtService.verify(tempToken, { secret: jwtSecret }) as any;
		} catch {
			throw new UnauthorizedException('Token temporário inválido ou expirado.');
		}

		if (payload.type !== 'temp_2fa') {
			throw new UnauthorizedException('Token inválido.');
		}

		// Um tempToken revogado por excesso de tentativas nao volta a valer so
		// porque ainda nao expirou. Mesma mensagem do token invalido: quem
		// tenta reusar nao aprende nada com a resposta.
		if (await this.tokenBlacklistService.isBlacklisted(tempToken)) {
			throw new UnauthorizedException('Token temporário inválido ou expirado.');
		}

		const projection = [
			'+twoFactorSecret +twoFactorFailedAttempts +twoFactorFirstFailedAttemptAt',
			extraProjection,
		]
			.filter(Boolean)
			.join(' ');

		const user = await UserModel.findById(payload.userId).select(projection);
		if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
			throw new BadRequestException('2FA não configurado para este usuário.');
		}

		const now = new Date();
		const attemptState = readAttemptState(user);

		// Bloqueio conferido ANTES de validar o codigo: validar primeiro
		// devolveria ao atacante a informacao que o bloqueio existe para negar.
		if (isTwoFactorBlocked(attemptState, now)) {
			await this.revokeTempToken(tempToken, payload.exp);
			throw new UnauthorizedException(
				'Muitas tentativas de verificação. Faça login novamente.'
			);
		}

		return { payload, user, attemptState, now };
	}

	/**
	 * Contabiliza uma tentativa errada — de TOTP ou de código de recuperação,
	 * indiferentemente — e derruba o tempToken quando o limite fecha.
	 *
	 * O contador é um só de propósito (`twoFactorFailedAttempts`): os dois
	 * endpoints são caminhos alternativos para o mesmo segundo fator, e um
	 * contador por endpoint dobraria o orçamento do atacante.
	 */
	private async registerFailure(
		userId: string,
		attemptState: TwoFactorAttemptState,
		now: Date,
		token: { tempToken: string; exp?: number }
	): Promise<void> {
		const nextState = registerFailedAttempt(attemptState, now);
		await this.persistAttemptState(userId, nextState);

		if (hasReachedLimit(nextState)) {
			await this.revokeTempToken(token.tempToken, token.exp);
			throw new UnauthorizedException(
				'Muitas tentativas de verificação. Faça login novamente.'
			);
		}
	}

	/**
	 * Grava a contagem de tentativas com `updateOne` em vez de mexer no
	 * documento carregado: `issueSessionTokens` faz o proprio `save()` logo em
	 * seguida no caminho de sucesso, e um `save()` extra aqui competiria com
	 * ele pela versao do documento.
	 */
	private async persistAttemptState(
		userId: string,
		state: TwoFactorAttemptState
	): Promise<void> {
		await UserModel.updateOne(
			{ _id: userId },
			{
				$set: {
					twoFactorFailedAttempts: state.failedAttempts,
					twoFactorFirstFailedAttemptAt: state.firstFailedAttemptAt,
				},
			}
		).exec();
	}

	/**
	 * Revoga o tempToken reaproveitando a blacklist que ja existe para os
	 * access tokens — mesmo mecanismo, mesma colecao com TTL, nenhuma
	 * dependencia nova. Sem `exp` no payload nao ha o que revogar de forma
	 * limpa, e a contagem por usuario ja segura a tentativa seguinte.
	 */
	private async revokeTempToken(
		tempToken: string,
		exp?: number
	): Promise<void> {
		if (!exp) {
			return;
		}

		await this.tokenBlacklistService.addToBlacklist(tempToken, exp);
	}

	/**
	 * Verifica se o código TOTP é válido sem alterar o estado (usado internamente).
	 */
	isCodeValid(code: string, secret: string): boolean {
		return authenticator.verify({ token: code, secret });
	}
}
