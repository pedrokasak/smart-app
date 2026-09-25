import { Logger } from '@nestjs/common';
import {
	PixGatewayPort,
	PixUnavailableError,
} from 'src/payments/pix/application/pix-gateway.port';

const MESSAGE =
	'Pagamento por PIX desligado: ASAAS_API_KEY não está configurada com uma ' +
	'chave válida do Asaas.';

/**
 * Null object quando não há chave do Asaas (TRA-195). Mesmo padrão do
 * `DisabledCredentialCipher`: o servidor sobe, e o checkout PIX responde 503
 * com mensagem clara em vez de tentar chamar o provedor com uma chave falsa.
 */
export class DisabledPixGateway implements PixGatewayPort {
	private readonly logger = new Logger(DisabledPixGateway.name);

	constructor() {
		this.logger.warn(MESSAGE);
	}

	isEnabled(): boolean {
		return false;
	}

	createCustomer(): never {
		throw new PixUnavailableError(MESSAGE);
	}

	createCharge(): never {
		throw new PixUnavailableError(MESSAGE);
	}

	getQrCode(): never {
		throw new PixUnavailableError(MESSAGE);
	}
}
