import { EmailService } from './email.service';
import { EmailSender } from './ports/email-sender.port';

describe('EmailService', () => {
	function buildService() {
		const sender: EmailSender = {
			send: jest.fn().mockResolvedValue(undefined),
		};
		const service = new EmailService(sender);
		return { service, sender };
	}

	describe('sendPurchaseIntentConfirmationEmail', () => {
		it('sends a confirmation email mentioning the plan name', async () => {
			const { service, sender } = buildService();

			await service.sendPurchaseIntentConfirmationEmail(
				'investidor@example.com',
				'Premium'
			);

			expect(sender.send).toHaveBeenCalledWith(
				expect.objectContaining({
					to: 'investidor@example.com',
					subject: expect.stringContaining('Premium'),
					html: expect.stringContaining('Premium'),
				})
			);
		});
	});
});
