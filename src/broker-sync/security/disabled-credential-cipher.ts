import { Logger } from '@nestjs/common';
import {
	BrokerCipherUnavailableError,
	BrokerCredentialCipher,
} from './broker-credential-cipher';

const MESSAGE =
	'Integracao com corretoras desligada: BROKER_ENCRYPTION_KEY nao esta ' +
	'configurada. Gere uma chave com `openssl rand -hex 32` e defina a ' +
	'variavel antes de guardar credenciais de corretora.';

/**
 * Null object da porta `BrokerCredentialCipher` para quando
 * `BROKER_ENCRYPTION_KEY` esta ausente (TRA-144).
 *
 * Mesmo padrao do `DisabledEventQueueAdapter` (TRA-136, fase 3) e do
 * `DisabledWebPushAdapter` (fase 6): o resto do grafo nao precisa saber que a
 * configuracao sumiu.
 *
 * A diferenca em relacao aos outros dois e deliberada e importante: aqueles
 * null objects ENGOLEM a operacao (nao enfileira, nao envia) porque perder um
 * push nao machuca ninguem. Aqui, engolir significaria guardar a credencial em
 * claro ou sob uma chave conhecida — que e exatamente o defeito que este
 * commit corrige. Entao este null object LANCA. Feature desligada e honesta e
 * melhor que feature funcionando de forma insegura.
 *
 * O que continua funcionando sem a chave: listar conexoes, desconectar. O que
 * para: gravar credencial nova e sincronizar (503, com mensagem de operador).
 */
export class DisabledCredentialCipher implements BrokerCredentialCipher {
	private readonly logger = new Logger(DisabledCredentialCipher.name);

	constructor() {
		// Uma vez, na construcao. Repetir a cada chamada transformaria uma
		// configuracao ausente em ruido permanente de log.
		this.logger.warn(MESSAGE);
	}

	isEnabled(): boolean {
		return false;
	}

	encrypt(): never {
		throw new BrokerCipherUnavailableError(MESSAGE);
	}

	decrypt(): never {
		throw new BrokerCipherUnavailableError(MESSAGE);
	}
}
