import { Logger } from '@nestjs/common';
import { PurchaseIntentService } from './leads.service';
import { EmailService } from 'src/notifications/email/email.service';

describe('PurchaseIntentService', () => {
	function buildService(overrides?: { resendContactsCreate?: jest.Mock }) {
		const emailService = {
			sendPurchaseIntentConfirmationEmail: jest
				.fn()
				.mockResolvedValue(undefined),
		} as unknown as EmailService;
		const resendContactsCreate =
			overrides?.resendContactsCreate ??
			jest.fn().mockResolvedValue({ data: { id: 'contact_1' } });
		const resendClient = { contacts: { create: resendContactsCreate } };

		const service = new PurchaseIntentService(
			emailService,
			resendClient as any
		);
		return { service, emailService, resendContactsCreate };
	}

	it('adds the contact to the Resend audience with the plan name as a property', async () => {
		const { service, resendContactsCreate } = buildService();
		process.env.RESEND_AUDIENCE_ID = 'audience_123';

		await service.captureIntent({
			email: 'investidor@example.com',
			planName: 'Premium',
		});

		expect(resendContactsCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				audienceId: 'audience_123',
				email: 'investidor@example.com',
				properties: expect.objectContaining({ planName: 'Premium' }),
			})
		);
	});

	it('sends the confirmation email', async () => {
		const { service, emailService } = buildService();
		process.env.RESEND_AUDIENCE_ID = 'audience_123';

		await service.captureIntent({
			email: 'investidor@example.com',
			planName: 'Premium',
		});

		expect(
			emailService.sendPurchaseIntentConfirmationEmail
		).toHaveBeenCalledWith('investidor@example.com', 'Premium');
	});

	it('returns success even when the Resend contact creation fails', async () => {
		const failingCreate = jest.fn().mockRejectedValue(new Error('Resend down'));
		const { service } = buildService({ resendContactsCreate: failingCreate });
		process.env.RESEND_AUDIENCE_ID = 'audience_123';

		const result = await service.captureIntent({
			email: 'investidor@example.com',
			planName: 'Premium',
		});

		expect(result).toEqual({ success: true });
	});

	it('returns success even when sending the confirmation email fails', async () => {
		const { service, emailService } = buildService();
		process.env.RESEND_AUDIENCE_ID = 'audience_123';
		(
			emailService.sendPurchaseIntentConfirmationEmail as jest.Mock
		).mockRejectedValue(new Error('email provider down'));

		const result = await service.captureIntent({
			email: 'investidor@example.com',
			planName: 'Premium',
		});

		expect(result).toEqual({ success: true });
	});

	it('skips the Resend contact call when RESEND_AUDIENCE_ID is not configured', async () => {
		const { service, resendContactsCreate } = buildService();
		delete process.env.RESEND_AUDIENCE_ID;

		const result = await service.captureIntent({
			email: 'investidor@example.com',
			planName: 'Premium',
		});

		expect(resendContactsCreate).not.toHaveBeenCalled();
		expect(result).toEqual({ success: true });
	});

	it('logs a warning and skips the Resend contact call when RESEND_API_KEY is not configured but RESEND_AUDIENCE_ID is', async () => {
		const originalApiKey = process.env.RESEND_API_KEY;
		delete process.env.RESEND_API_KEY;
		process.env.RESEND_AUDIENCE_ID = 'audience_123';

		const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
		const emailService = {
			sendPurchaseIntentConfirmationEmail: jest
				.fn()
				.mockResolvedValue(undefined),
		} as unknown as EmailService;

		const service = new PurchaseIntentService(emailService);

		const result = await service.captureIntent({
			email: 'investidor@example.com',
			planName: 'Premium',
		});

		expect(warnSpy).toHaveBeenCalledWith(
			'RESEND_API_KEY não configurado; pulando criação de contato na audience'
		);
		expect(result).toEqual({ success: true });

		warnSpy.mockRestore();
		if (originalApiKey === undefined) {
			delete process.env.RESEND_API_KEY;
		} else {
			process.env.RESEND_API_KEY = originalApiKey;
		}
	});
});
