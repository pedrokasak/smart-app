import { SubscriptionExpiryScheduler } from './subscription-expiry.scheduler';
import { WebhooksService } from 'src/subscription/webhooks.service';

/**
 * TRA-192: `checkExpiredSubscriptions` existia, estava correta, e nunca
 * rodava — nenhum `@Cron`, nenhum endpoint, nenhum consumidor. O efeito era
 * acesso pago vitalício para concessões de teste já vencidas.
 */
describe('SubscriptionExpiryScheduler', () => {
	function build() {
		const webhooksService = {
			checkExpiredSubscriptions: jest.fn().mockResolvedValue(undefined),
		};
		const scheduler = new SubscriptionExpiryScheduler(
			webhooksService as unknown as WebhooksService
		);
		return { scheduler, webhooksService };
	}

	it('dispara a varredura de vencidas', async () => {
		const { scheduler, webhooksService } = build();

		await scheduler.runDaily();

		expect(webhooksService.checkExpiredSubscriptions).toHaveBeenCalledTimes(1);
	});

	it('não propaga falha: um dia sem varredura não pode derrubar o processo', async () => {
		const { scheduler, webhooksService } = build();
		webhooksService.checkExpiredSubscriptions.mockRejectedValue(
			new Error('mongo down')
		);

		await expect(scheduler.runDaily()).resolves.toBeUndefined();
	});
});
