import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { EMAIL_SENDER } from './ports/email-sender.port';
import { ResendEmailAdapter } from './adapters/resend-email.adapter';

@Module({
	providers: [
		EmailService,
		{ provide: EMAIL_SENDER, useClass: ResendEmailAdapter },
	],
	exports: [EmailService],
})
export class EmailModule {}
