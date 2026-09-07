import { Injectable, Logger } from '@nestjs/common';
import {
	BreachedPasswordChecker,
	BreachedPasswordVerdict,
} from 'src/authentication/application/ports/breached-password-checker.port';

/**
 * Null object para quando a checagem esta desligada (`HIBP_ENABLED=false`),
 * mesmo padrao do `DisabledWebPushAdapter` e do `DisabledCredentialCipher`.
 *
 * Devolve `unknown`, nao `not_breached`. A diferenca importa: `not_breached`
 * seria uma afirmacao ("verificamos, esta limpa") que ninguem fez. `unknown`
 * e a verdade — nao houve checagem — e cai no mesmo caminho de falha aberta
 * ja existente, sem um segundo ramo de codigo para manter.
 *
 * O desligamento existe para o ambiente de teste e de desenvolvimento
 * offline, onde chamar um servico externo a cada cadastro so adiciona
 * latencia e ruido.
 */
@Injectable()
export class DisabledBreachedPasswordAdapter implements BreachedPasswordChecker {
	private readonly logger = new Logger(DisabledBreachedPasswordAdapter.name);

	constructor() {
		this.logger.warn(
			'Checagem de senha vazada DESLIGADA (HIBP_ENABLED=false): senhas de vazamentos públicos serão aceitas no cadastro.'
		);
	}

	async check(): Promise<BreachedPasswordVerdict> {
		return 'unknown';
	}
}
