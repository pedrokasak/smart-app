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
			planId: '6995af0198591333bb0d4862',
		});

		expect(purchaseIntentService.captureIntent).toHaveBeenCalledWith({
			email: 'investidor@example.com',
			planId: '6995af0198591333bb0d4862',
		});
		expect(result).toEqual({ success: true });
	});
});
