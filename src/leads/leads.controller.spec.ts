import { LeadsController } from './leads.controller';
import { PurchaseIntentService } from './leads.service';

describe('LeadsController', () => {
	it('delegates to PurchaseIntentService.captureIntent and returns its result', async () => {
		const purchaseIntentService = {
			captureIntent: jest.fn().mockResolvedValue({ success: true }),
		} as unknown as PurchaseIntentService;
		const controller = new LeadsController(purchaseIntentService);

		const result = await controller.capturePurchaseIntent({
			email: 'investidor@example.com',
			planName: 'Premium',
		});

		expect(purchaseIntentService.captureIntent).toHaveBeenCalledWith({
			email: 'investidor@example.com',
			planName: 'Premium',
		});
		expect(result).toEqual({ success: true });
	});
});
