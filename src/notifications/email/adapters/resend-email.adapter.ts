import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { EmailMessage, EmailSender } from '../ports/email-sender.port';

@Injectable()
export class ResendEmailAdapter implements EmailSender {
	private readonly logger = new Logger(ResendEmailAdapter.name);
	private readonly client: Resend | null;

	constructor() {
		const apiKey = process.env.RESEND_API_KEY;
		this.client = apiKey ? new Resend(apiKey) : null;
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
