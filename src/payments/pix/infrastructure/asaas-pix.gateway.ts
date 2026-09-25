import { Logger } from '@nestjs/common';
import {
	PixChargeInput,
	PixCustomerInput,
	PixGatewayError,
	PixGatewayPort,
	PixQrCode,
} from 'src/payments/pix/application/pix-gateway.port';

export interface AsaasConfig {
	apiKey: string;
	/** Com ou sem `/v3` — normalizado aqui. */
	baseUrl: string;
	timeoutMs?: number;
}

type FetchFn = typeof fetch;

/**
 * Adapter Asaas da porta de PIX (TRA-195). API v3.
 *
 * O cliente HTTP é injetável para os testes não dependerem de rede. Nenhum
 * erro do Asaas chega cru ao usuário: a descrição do provedor vai para o log,
 * e o usuário recebe uma mensagem nossa. A chave nunca é logada.
 */
export class AsaasPixGateway implements PixGatewayPort {
	private readonly logger = new Logger(AsaasPixGateway.name);
	private readonly baseUrl: string;

	constructor(
		private readonly config: AsaasConfig,
		private readonly fetchFn: FetchFn = fetch
	) {
		this.baseUrl = AsaasPixGateway.normalizeBaseUrl(config.baseUrl);
	}

	/** `https://api-sandbox.asaas.com/` e `.../v3/` viram `.../v3`. */
	static normalizeBaseUrl(raw: string): string {
		const trimmed = String(raw || '')
			.trim()
			.replace(/\/+$/, '');
		return trimmed.endsWith('/v3') ? trimmed : `${trimmed}/v3`;
	}

	isEnabled(): boolean {
		return true;
	}

	async createCustomer(input: PixCustomerInput): Promise<string> {
		const body = await this.request<{ id: string }>('POST', '/customers', {
			name: input.name,
			email: input.email,
			cpfCnpj: input.cpf,
			externalReference: input.externalReference,
			// O Asaas manda e-mail/SMS de cobrança por padrão; quem avisa o
			// usuário é o Trackerr.
			notificationDisabled: true,
		});
		return body.id;
	}

	async createCharge(input: PixChargeInput): Promise<{ paymentId: string }> {
		const body = await this.request<{ id: string }>('POST', '/payments', {
			customer: input.customerId,
			billingType: 'PIX',
			value: input.value,
			dueDate: input.dueDate,
			description: input.description,
			externalReference: input.externalReference,
		});
		return { paymentId: body.id };
	}

	async getQrCode(paymentId: string): Promise<PixQrCode> {
		const body = await this.request<{
			encodedImage: string;
			payload: string;
			expirationDate: string;
		}>('GET', `/payments/${encodeURIComponent(paymentId)}/pixQrCode`);

		if (!body?.payload || !body?.encodedImage) {
			throw new PixGatewayError('QR code PIX indisponível no momento.');
		}
		return {
			payload: body.payload,
			encodedImage: body.encodedImage,
			// O Asaas devolve "YYYY-MM-DD HH:mm:ss" em horário de Brasília.
			expiresAt: AsaasPixGateway.parseBrasiliaDateTime(body.expirationDate),
		};
	}

	static parseBrasiliaDateTime(raw: string): Date {
		const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(
			String(raw || '')
		);
		if (!match) return new Date(NaN);
		return new Date(`${match[1]}T${match[2]}-03:00`);
	}

	private async request<T>(
		method: 'GET' | 'POST',
		path: string,
		payload?: unknown
	): Promise<T> {
		let response: Response;
		try {
			response = await this.fetchFn(`${this.baseUrl}${path}`, {
				method,
				headers: {
					access_token: this.config.apiKey,
					'Content-Type': 'application/json',
					Accept: 'application/json',
					// Contas Asaas novas recusam requisição sem User-Agent.
					'User-Agent': 'trackerr-server',
				},
				body: payload === undefined ? undefined : JSON.stringify(payload),
				signal: AbortSignal.timeout(this.config.timeoutMs ?? 15000),
			});
		} catch (error) {
			this.logger.error(
				`Asaas ${method} ${path} falhou na rede: ${(error as Error).message}`
			);
			throw new PixGatewayError(
				'Não foi possível falar com o provedor de PIX. Tente de novo em instantes.'
			);
		}

		const text = await response.text();
		if (!response.ok) {
			this.logger.error(
				`Asaas ${method} ${path} -> ${response.status}: ${AsaasPixGateway.describeErrors(text)}`
			);
			throw new PixGatewayError(
				'O provedor de PIX recusou a operação. Confira o CPF e tente de novo.',
				response.status
			);
		}

		try {
			return JSON.parse(text) as T;
		} catch {
			throw new PixGatewayError('Resposta inválida do provedor de PIX.');
		}
	}

	/** Só `code: description` dos erros do Asaas — nada do corpo enviado. */
	private static describeErrors(text: string): string {
		try {
			const parsed = JSON.parse(text) as {
				errors?: Array<{ code?: string; description?: string }>;
			};
			if (Array.isArray(parsed.errors)) {
				return parsed.errors
					.map((error) => `${error.code}: ${error.description}`)
					.join('; ');
			}
		} catch {
			// corpo não-JSON
		}
		return text.slice(0, 200);
	}
}
