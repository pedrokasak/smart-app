import { Logger } from '@nestjs/common';
import { PurchaseIntentService } from './leads.service';

describe('PurchaseIntentService', () => {
	const originalAudienceId = process.env.RESEND_AUDIENCE_ID;

	beforeEach(() => {
		process.env.RESEND_AUDIENCE_ID = 'audience_123';
	});

	afterAll(() => {
		if (originalAudienceId === undefined) {
			delete process.env.RESEND_AUDIENCE_ID;
		} else {
			process.env.RESEND_AUDIENCE_ID = originalAudienceId;
		}
	});

	function makeSubscriptionModel(plan: unknown) {
		return {
			findById: jest.fn().mockResolvedValue(plan),
		} as any;
	}

	const activePlan = {
		_id: '6995af0198591333bb0d4862',
		name: 'Pro',
		isActive: true,
	};

	it('uses the plan name from the database, not from the request', async () => {
		const emailService = {
			sendPurchaseIntentConfirmationEmail: jest
				.fn()
				.mockResolvedValue(undefined),
		} as any;
		const contacts = {
			create: jest.fn().mockResolvedValue({ error: null }),
			update: jest.fn().mockResolvedValue({ error: null }),
		};
		const service = new PurchaseIntentService(
			emailService,
			makeSubscriptionModel(activePlan),
			{ contacts } as any
		);

		await service.captureIntent({
			email: 'investidor@example.com',
			planId: '6995af0198591333bb0d4862',
		} as any);

		expect(
			emailService.sendPurchaseIntentConfirmationEmail
		).toHaveBeenCalledWith('investidor@example.com', 'Pro');
	});

	it('rejects an unknown plan with a generic message', async () => {
		const emailService = {
			sendPurchaseIntentConfirmationEmail: jest.fn(),
		} as any;
		const service = new PurchaseIntentService(
			emailService,
			makeSubscriptionModel(null),
			{ contacts: { create: jest.fn(), update: jest.fn() } } as any
		);

		await expect(
			service.captureIntent({
				email: 'investidor@example.com',
				planId: '6995af0198591333bb0d4862',
			} as any)
		).rejects.toThrow('Plano inválido');

		expect(
			emailService.sendPurchaseIntentConfirmationEmail
		).not.toHaveBeenCalled();
	});

	it('rejects an inactive plan', async () => {
		const emailService = {
			sendPurchaseIntentConfirmationEmail: jest.fn(),
		} as any;
		const service = new PurchaseIntentService(
			emailService,
			makeSubscriptionModel({ ...activePlan, isActive: false }),
			{ contacts: { create: jest.fn(), update: jest.fn() } } as any
		);

		await expect(
			service.captureIntent({
				email: 'investidor@example.com',
				planId: '6995af0198591333bb0d4862',
			} as any)
		).rejects.toThrow('Plano inválido');
	});

	it('sends utm values to the contact properties', async () => {
		const emailService = {
			sendPurchaseIntentConfirmationEmail: jest
				.fn()
				.mockResolvedValue(undefined),
		} as any;
		const contacts = {
			create: jest.fn().mockResolvedValue({ error: null }),
			update: jest.fn().mockResolvedValue({ error: null }),
		};
		const service = new PurchaseIntentService(
			emailService,
			makeSubscriptionModel(activePlan),
			{ contacts } as any
		);

		await service.captureIntent({
			email: 'investidor@example.com',
			planId: '6995af0198591333bb0d4862',
			utmSource: 'reddit',
			utmCampaign: 'validacao',
		} as any);

		expect(contacts.create).toHaveBeenCalledWith(
			expect.objectContaining({
				properties: expect.objectContaining({
					planName: 'Pro',
					utmSource: 'reddit',
					utmCampaign: 'validacao',
				}),
			})
		);
	});

	it('updates the existing contact when creation fails', async () => {
		const emailService = {
			sendPurchaseIntentConfirmationEmail: jest
				.fn()
				.mockResolvedValue(undefined),
		} as any;
		const contacts = {
			create: jest
				.fn()
				.mockResolvedValue({ error: { message: 'Contact already exists' } }),
			update: jest.fn().mockResolvedValue({ error: null }),
		};
		const service = new PurchaseIntentService(
			emailService,
			makeSubscriptionModel(activePlan),
			{ contacts } as any
		);

		await service.captureIntent({
			email: 'investidor@example.com',
			planId: '6995af0198591333bb0d4862',
		} as any);

		expect(contacts.update).toHaveBeenCalledWith(
			expect.objectContaining({
				email: 'investidor@example.com',
				properties: expect.objectContaining({ planName: 'Pro' }),
			})
		);
	});

	it('still returns success when both create and update fail', async () => {
		const emailService = {
			sendPurchaseIntentConfirmationEmail: jest
				.fn()
				.mockResolvedValue(undefined),
		} as any;
		const contacts = {
			create: jest.fn().mockRejectedValue(new Error('resend down')),
			update: jest.fn().mockRejectedValue(new Error('resend down')),
		};
		const service = new PurchaseIntentService(
			emailService,
			makeSubscriptionModel(activePlan),
			{ contacts } as any
		);

		const result = await service.captureIntent({
			email: 'investidor@example.com',
			planId: '6995af0198591333bb0d4862',
		} as any);

		expect(result).toEqual({ success: true });
		expect(emailService.sendPurchaseIntentConfirmationEmail).toHaveBeenCalled();
	});

	it('logs an error stating the lead was NOT recorded when both create and update fail', async () => {
		const errorSpy = jest
			.spyOn(Logger.prototype, 'error')
			.mockImplementation(() => undefined);

		const emailService = {
			sendPurchaseIntentConfirmationEmail: jest
				.fn()
				.mockResolvedValue(undefined),
		} as any;
		const contacts = {
			create: jest.fn().mockRejectedValue(new Error('resend down')),
			update: jest.fn().mockRejectedValue(new Error('resend down')),
		};
		const service = new PurchaseIntentService(
			emailService,
			makeSubscriptionModel(activePlan),
			{ contacts } as any
		);

		try {
			await service.captureIntent({
				email: 'investidor@example.com',
				planId: '6995af0198591333bb0d4862',
			} as any);

			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining('investidor@example.com')
			);
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringMatching(/NÃO registrado/)
			);
		} finally {
			errorSpy.mockRestore();
		}
	});
});
