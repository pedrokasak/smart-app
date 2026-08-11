import { Injectable, Logger, Optional } from '@nestjs/common';
import { Resend } from 'resend';
import { EmailService } from 'src/notifications/email/email.service';
import { PurchaseIntentDto } from './dto/purchase-intent.dto';

@Injectable()
export class PurchaseIntentService {
	private readonly logger = new Logger(PurchaseIntentService.name);
	private readonly resendClient: Pick<Resend, 'contacts'>;

	constructor(
		private readonly emailService: EmailService,
		@Optional() resendClient?: Pick<Resend, 'contacts'>
	) {
		const apiKey = process.env.RESEND_API_KEY;
		this.resendClient =
			resendClient ?? (apiKey ? new Resend(apiKey) : ({} as Resend));
	}

	async captureIntent(dto: PurchaseIntentDto): Promise<{ success: true }> {
		const audienceId = process.env.RESEND_AUDIENCE_ID;

		if (audienceId && this.resendClient?.contacts) {
			try {
				await this.resendClient.contacts.create({
					audienceId,
					email: dto.email,
					properties: { planName: dto.planName },
				} as Parameters<Resend['contacts']['create']>[0]);
			} catch (error) {
				this.logger.warn(
					`Falha ao adicionar contato na audience do Resend: ${error?.message || error}`
				);
			}
		} else if (!audienceId) {
			this.logger.warn(
				'RESEND_AUDIENCE_ID não configurado; pulando criação de contato na audience'
			);
		} else {
			this.logger.warn(
				'RESEND_API_KEY não configurado; pulando criação de contato na audience'
			);
		}

		try {
			await this.emailService.sendPurchaseIntentConfirmationEmail(
				dto.email,
				dto.planName
			);
		} catch (error) {
			this.logger.warn(
				`Falha ao enviar e-mail de confirmação de interesse: ${error?.message || error}`
			);
		}

		return { success: true };
	}
}
