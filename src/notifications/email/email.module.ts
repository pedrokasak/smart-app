import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { EMAIL_SENDER } from './ports/email-sender.port';
import { ResendEmailAdapter } from './adapters/resend-email.adapter';

@Module({
	providers: [
		EmailService,
		{ provide: EMAIL_SENDER, useClass: ResendEmailAdapter },
	],
	// `EMAIL_SENDER` e exportado porque `EmailNotificationChannel`
	// (NotificationsModule) envia pela porta direto, sem passar pelo
	// EmailService. Sem o export o AppModule nao subia (TRA-154).
	exports: [EmailService, EMAIL_SENDER],
})
export class EmailModule {}
