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
		await Promise.race([this.checkSenderDomain(), this.checkTimeout()]);
	}

	private checkTimeout(): Promise<void> {
		return new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				this.logger.warn(
					`Checagem do domínio do remetente passou de ` +
						`${ResendEmailAdapter.DOMAIN_CHECK_TIMEOUT_MS}ms e foi abandonada. ` +
						`A subida segue normalmente; o envio não foi validado.`
				);
				resolve();
			}, ResendEmailAdapter.DOMAIN_CHECK_TIMEOUT_MS);

			// Não segura o event loop: se a checagem responder antes, o processo
			// não precisa esperar este timer para poder encerrar.
			timer.unref?.();
		});
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
		} = {
			from,
			to: message.to,
			subject: message.subject,
			html: message.html,
			text: message.text,
		};

		if (message.replyTo) payload.replyTo = message.replyTo;

		const { data, error } = await this.client.emails.send(payload);

		if (error) {
			this.logger.error(
				`Resend send failed: ${error.message ?? 'unknown error'}`
			);
			throw new Error('Email send failed');
		}

		this.logger.log(`Resend email sent: ${data?.id ?? 'unknown id'}`);
	}
}
