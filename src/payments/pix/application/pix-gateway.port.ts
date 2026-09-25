/**
 * Porta do provedor de PIX (TRA-195). O Asaas é o adapter de hoje; o resto do
 * módulo não conhece URL, header nem formato do Asaas — trocar de provedor é
 * escrever outro adapter.
 */
export const PIX_GATEWAY = Symbol('PIX_GATEWAY');

export interface PixCustomerInput {
	name: string;
	email: string;
	/** Só dígitos. */
	cpf: string;
	/** Id do usuário no Trackerr, para conciliação no painel do provedor. */
	externalReference: string;
}

export interface PixChargeInput {
	customerId: string;
	value: number;
	/** `YYYY-MM-DD`. */
	dueDate: string;
	description: string;
	/** Id da cobrança no Trackerr. Volta no webhook. */
	externalReference: string;
}

export interface PixQrCode {
	/** Copia-e-cola. */
	payload: string;
	/** PNG em base64, sem o prefixo `data:`. */
	encodedImage: string;
	expiresAt: Date;
}

export interface PixGatewayPort {
	isEnabled(): boolean;
	createCustomer(input: PixCustomerInput): Promise<string>;
	createCharge(input: PixChargeInput): Promise<{ paymentId: string }>;
	getQrCode(paymentId: string): Promise<PixQrCode>;
}

/** Provedor recusou ou está fora: mensagem segura para o usuário. */
export class PixGatewayError extends Error {
	constructor(
		message: string,
		readonly providerStatus?: number
	) {
		super(message);
		this.name = 'PixGatewayError';
	}
}

/** PIX desligado por configuração (sem chave do provedor). */
export class PixUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PixUnavailableError';
	}
}
