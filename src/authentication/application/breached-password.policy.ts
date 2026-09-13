import {
	BadRequestException,
	Inject,
	Injectable,
	Logger,
} from '@nestjs/common';
import {
	BREACHED_PASSWORD_CHECKER,
	BreachedPasswordChecker,
} from 'src/authentication/application/ports/breached-password-checker.port';

/**
 * Mensagem em pt-BR e ACIONAVEL de proposito. "Senha inválida" seria a pior
 * resposta possivel aqui: o usuario escolheu uma senha que atende todas as
 * regras de formato e nao teria como adivinhar o que houve — muitos tentam
 * variacoes da mesma senha vazada ate desistir do cadastro.
 *
 * A mensagem tambem nao revela QUAL vazamento nem quantas vezes a senha
 * aparece: contagem e detalhe que so serve para quem esta do outro lado.
 */
export const BREACHED_PASSWORD_MESSAGE =
	'Esta senha apareceu em vazamentos públicos de dados e não pode ser usada. Escolha outra senha.';

/**
 * Politica de senha vazada (TRK-012, ASVS 5.0 6.2.12).
 *
 * Argon2id ja protege bem a senha guardada, e o cadastro ja exige 8
 * caracteres — mas nada checava a senha contra corpus de vazamento, que e o
 * controle que mais reduz credential stuffing na pratica. Uma senha de 12
 * caracteres que aparece em milhoes de vazamentos e forte no papel e
 * inutil no mundo real.
 *
 * FALHA ABERTA, E ISSO E DELIBERADO. Se a checagem nao conclui, o cadastro
 * segue. Recusar cadastro porque uma API de terceiro esta fora troca um
 * ganho pequeno de seguranca por indisponibilidade do produto — e o
 * atacante que quisesse forcar isso so precisaria derrubar o servico
 * externo. So `breached` recusa; `unknown` passa, com log.
 *
 * ONDE NAO SE APLICA: login. Checar no login puniria o usuario existente no
 * pior momento possivel, sem caminho de saida — ele nao consegue nem entrar
 * para trocar a senha. A troca acontece no cadastro e nas rotas de mudanca
 * de senha, onde ele esta justamente escolhendo uma nova.
 */
@Injectable()
export class BreachedPasswordPolicy {
	private readonly logger = new Logger(BreachedPasswordPolicy.name);

	constructor(
		@Inject(BREACHED_PASSWORD_CHECKER)
		private readonly checker: BreachedPasswordChecker
	) {}

	async assertNotBreached(password: string): Promise<void> {
		if (!password) return;

		const verdict = await this.checker.check(password);

		if (verdict === 'breached') {
			throw new BadRequestException(BREACHED_PASSWORD_MESSAGE);
		}

		if (verdict === 'unknown') {
			// Nunca a senha, nunca o hash — so o fato de que a checagem nao
			// concluiu. Se esta linha aparecer em volume, o alerta e sobre a
			// disponibilidade da checagem, nao sobre o usuario.
			this.logger.warn(
				'Checagem de senha vazada indisponível; cadastro/troca seguiu sem ela (falha aberta).'
			);
		}
	}
}
