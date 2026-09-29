import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Resend } from 'resend';
import { EmailMessage, EmailSender } from '../ports/email-sender.port';

@Injectable()
export class ResendEmailAdapter implements EmailSender, OnModuleInit {
	private readonly logger = new Logger(ResendEmailAdapter.name);
	private readonly client: Resend | null;

	constructor() {
		const apiKey = process.env.RESEND_API_KEY;
		this.client = apiKey ? new Resend(apiKey) : null;
	}

	/**
	 * Teto de espera da checagem de domínio na subida. O `try/catch` de
	 * `checkSenderDomain` cobre falha rápida, mas não cobre LENTIDÃO: o SDK do
	 * Resend usa `fetch` sem timeout, e o Nest aguarda `onModuleInit` resolver
	 * antes de dar o módulo por pronto. Com a API do Resend degradada, a
	 * conexão ficaria aberta, o boot nunca terminaria e o container nunca
	 * ficaria healthy — pendurado em silêncio, que é pior que quebrar.
	 */
	private static readonly DOMAIN_CHECK_TIMEOUT_MS = 5_000;

	async onModuleInit(): Promise<void> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<void>((resolve) => {
			timer = setTimeout(() => {
				this.logger.warn(
					`Checagem do domínio do remetente passou de ` +
						`${ResendEmailAdapter.DOMAIN_CHECK_TIMEOUT_MS}ms e foi abandonada. ` +
						`A subida segue normalmente; o envio não foi validado.`
				);
				resolve();
			}, ResendEmailAdapter.DOMAIN_CHECK_TIMEOUT_MS);

			// Não segura o event loop enquanto a checagem está em andamento.
			timer.unref?.();
		});

		try {
			await Promise.race([this.checkSenderDomain(), timeout]);
		} finally {
			// Sem este clear o timer disparava mesmo quando a checagem tinha
			// terminado antes: em produção o log dizia "domínio verificado" e,
			// segundos depois, "passou de 5000ms e foi abandonada" — o aviso
			// contradizendo o que acabara de acontecer.
			clearTimeout(timer);
		}
	}

	/**
	 * Confere na subida se o domínio de `RESEND_FROM` está verificado na conta
	 * Resend. O provedor recusa envio de domínio não verificado, então essa
	 * divergência derruba TODO e-mail — inclusive o de recuperação de senha,
	 * que é o único caminho de volta para quem perdeu o acesso.
	 *
	 * Sem esta checagem a descoberta acontece no primeiro reset de senha de um
	 * usuário real. Foi exatamente o que houve (TRA-151): `RESEND_FROM`
	 * apontava para `no-reply@trakkerwallet.com.br` enquanto o único domínio
	 * verificado era `trackerr.com.br`, e os envios falhavam em silêncio.
	 *
	 * NÃO derruba o boot de propósito: Resend indisponível no instante da
	 * subida não pode impedir a API inteira de servir. O que faltava era o
	 * sinal, e o sinal é um log de ERROR.
	 */
	private async checkSenderDomain(): Promise<void> {
		if (!this.client) return;

		const from = process.env.RESEND_FROM ?? '';
		const domain = from.split('@').pop()?.trim().toLowerCase();
		if (!domain) return;

		try {
			const response: any = await this.client.domains.list();
			if (response?.error) {
				this.logger.warn(
					`Não foi possível listar domínios do Resend: ${
						response.error.message ?? 'erro desconhecido'
					}`
				);
				return;
			}

			// O SDK já devolveu `{ data: Domain[] }` e `{ data: { data: [...] } }`
			// em versões diferentes; aceitar as duas evita que um bump de
			// dependência transforme esta checagem num falso positivo.
			const domains: any[] =
				response?.data?.data ?? response?.data ?? response ?? [];
			if (!Array.isArray(domains)) {
				// Retornar em silêncio aqui transformaria esta checagem num
				// no-op permanente: a próxima configuração errada de
				// `RESEND_FROM` voltaria a ser descoberta pelo primeiro usuário
				// que tentasse recuperar a senha, com a falsa sensação de estar
				// coberta. Se o formato mudar, isso tem que aparecer.
				this.logger.warn(
					'Resposta inesperada de domains.list() no Resend; a checagem ' +
						'do domínio do remetente foi pulada. Provável mudança de ' +
						'formato do SDK — revisar.'
				);
				return;
			}

			const match = domains.find(
				(item) => String(item?.name ?? '').toLowerCase() === domain
			);

			if (!match) {
				this.logger.error(
					`RESEND_FROM usa o domínio "${domain}", que não existe na conta ` +
						`Resend. TODO envio de e-mail vai falhar. Domínios na conta: ` +
						`${domains.map((item) => item?.name).join(', ') || '(nenhum)'}`
				);
				return;
			}

			if (match.status !== 'verified') {
				this.logger.error(
					`O domínio "${domain}" está com status "${match.status}" no Resend, ` +
						`não "verified". TODO envio de e-mail vai falhar.`
				);
				return;
			}

			this.logger.log(`Remetente "${from}" usa domínio verificado.`);
		} catch (error) {
			this.logger.warn(
				`Falha ao checar o domínio do remetente no Resend: ${
					(error as Error)?.message ?? 'erro desconhecido'
				}`
			);
		}
	}

	async send(message: EmailMessage): Promise<void> {
		if (!this.client) {
			if (process.env.NODE_ENV === 'production') {
				this.logger.error('RESEND_API_KEY is missing in production');
				throw new Error('Email provider not configured');
			}

			this.logger.warn('RESEND_API_KEY not set. Email mock output below.');
			this.logger.log('To: ' + message.to);
			this.logger.log('Subject: ' + message.subject);
			this.logger.log('From: ' + (message.from ?? 'default'));
			this.logger.log('Reply-To: ' + (message.replyTo ?? 'n/a'));
			this.logger.log('HTML: ' + message.html);
			if (message.text) this.logger.log('Text: ' + message.text);
			return;
		}

		const from = message.from ?? process.env.RESEND_FROM ?? '';
		if (!from) {
			if (process.env.NODE_ENV === 'production') {
				this.logger.error('RESEND_FROM is missing in production');
				throw new Error('Email provider not configured');
			}

			this.logger.warn('RESEND_FROM not set. Email mock output below.');
			this.logger.log('To: ' + message.to);
			this.logger.log('Subject: ' + message.subject);
			this.logger.log('From: ' + (message.from ?? 'default'));
			this.logger.log('Reply-To: ' + (message.replyTo ?? 'n/a'));
			this.logger.log('HTML: ' + message.html);
			if (message.text) this.logger.log('Text: ' + message.text);
			return;
		}

		const payload: {
			from: string;
			to: string;
			subject: string;
			html: string;
			text?: string;
			replyTo?: string;
			attachments?: { filename: string; content: Buffer }[];
		} = {
			from,
			to: message.to,
			subject: message.subject,
			html: message.html,
			text: message.text,
		};

		if (message.replyTo) payload.replyTo = message.replyTo;
		if (message.attachments?.length) payload.attachments = message.attachments;

		const { data, error } = await this.sendPaced(this.client, payload);

		if (error) {
			this.logger.error(
				`Resend send failed: ${error.message ?? 'unknown error'}`
			);
			throw new Error('Email send failed');
		}

		this.logger.log(`Resend email sent: ${data?.id ?? 'unknown id'}`);
	}

	/**
	 * Ritmo de envio (TRA-261). O Resend aceita 10 requisicoes/s por time
	 * (docs conferidas em 29/09/2026) e responde 429 acima disso. Ate aqui os
	 * e-mails saiam um a um; o aviso de fato relevante e o primeiro envio em
	 * RAJADA — uma acao popular vira centenas de jobs na fila, processados 20
	 * por vez — e o 429 virava entrega `failed`, sem nova tentativa.
	 *
	 * Espacar no processo (8/s, com folga) evita o 429; se ele vier mesmo
	 * assim (outra instancia, outro envio do time), espera o `retry-after` e
	 * tenta de novo algumas vezes antes de desistir.
	 */
	private static readonly MIN_SEND_INTERVAL_MS = 125;
	private static readonly RATE_LIMIT_RETRIES = 3;
	private nextSendAt = 0;

	private async sendPaced(
		client: Resend,
		payload: Parameters<Resend['emails']['send']>[0]
	): ReturnType<Resend['emails']['send']> {
		for (let attempt = 0; ; attempt += 1) {
			await this.waitForSendSlot();
			const response = await client.emails.send(payload);
			const rateLimited = response.error?.name === 'rate_limit_exceeded';
			if (!rateLimited || attempt >= ResendEmailAdapter.RATE_LIMIT_RETRIES) {
				return response;
			}
			const waitMs =
				this.retryAfterMs(response.headers) ?? 1000 * (attempt + 1);
			this.logger.warn(
				`Resend limitou o envio (429); nova tentativa em ${waitMs}ms`
			);
			await this.wait(waitMs);
		}
	}

	private async waitForSendSlot(): Promise<void> {
		const now = Date.now();
		const slot = Math.max(now, this.nextSendAt);
		this.nextSendAt = slot + ResendEmailAdapter.MIN_SEND_INTERVAL_MS;
		if (slot > now) await this.wait(slot - now);
	}

	private retryAfterMs(headers: Record<string, string> | null): number | null {
		const seconds = Number(headers?.['retry-after']);
		// Teto de 10s: um header estranho nao pode segurar o job da fila.
		return Number.isFinite(seconds) && seconds > 0
			? Math.min(seconds, 10) * 1000
			: null;
	}

	/** Separado para os testes nao esperarem de verdade. */
	protected wait(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
