import { EmailService } from './email.service';
import { EmailSender } from './ports/email-sender.port';
import { PortfolioDigestFacts } from 'src/notifications/portfolio-digest/domain/portfolio-digest.types';

function digestFacts(
	overrides: Partial<PortfolioDigestFacts> = {}
): PortfolioDigestFacts {
	return {
		periodStart: '2026-08-11',
		periodEnd: '2026-08-18',
		portfolioValue: 10000,
		periodChangePct: 5,
		periodChangeAbs: 500,
		topGainers: [{ symbol: 'PETR4', changePercent: 3 }],
		topLosers: [{ symbol: 'VALE3', changePercent: -2 }],
		watchItems: [],
		dividendsReceived: 100,
		hasSufficientData: true,
		...overrides,
	};
}

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

	describe('sendPortfolioDigestEmail', () => {
		it('inclui o link de unsubscribe sempre, narrativa ou não', async () => {
			const { service, sender } = buildService();

			await service.sendPortfolioDigestEmail('investidor@example.com', {
				facts: digestFacts(),
				narrative: null,
				unsubscribeUrl: 'https://trakker.com/unsubscribe?token=abc',
			});

			const call = (sender.send as jest.Mock).mock.calls[0][0];
			expect(call.html).toContain('https://trakker.com/unsubscribe?token=abc');
			expect(call.text).toContain('https://trakker.com/unsubscribe?token=abc');
		});

		it('sem narrativa: não menciona AiGeneratedNotice', async () => {
			const { service, sender } = buildService();

			await service.sendPortfolioDigestEmail('investidor@example.com', {
				facts: digestFacts(),
				narrative: null,
				unsubscribeUrl: 'https://trakker.com/unsubscribe?token=abc',
			});

			const call = (sender.send as jest.Mock).mock.calls[0][0];
			expect(call.html).not.toContain(
				'gerado com o auxílio de inteligência artificial'
			);
		});

		it('com narrativa: inclui o texto e o aviso de conteúdo gerado por IA', async () => {
			const { service, sender } = buildService();

			await service.sendPortfolioDigestEmail('investidor@example.com', {
				facts: digestFacts(),
				narrative: 'Sua carteira subiu essa semana, puxada por PETR4.',
				unsubscribeUrl: 'https://trakker.com/unsubscribe?token=abc',
			});

			const call = (sender.send as jest.Mock).mock.calls[0][0];
			expect(call.html).toContain(
				'Sua carteira subiu essa semana, puxada por PETR4.'
			);
			expect(call.html).toContain(
				'gerado com o auxílio de inteligência artificial'
			);
		});

		it('mostra em dash para portfolioValue null, nunca R$ 0,00', async () => {
			const { service, sender } = buildService();

			await service.sendPortfolioDigestEmail('investidor@example.com', {
				facts: digestFacts({ portfolioValue: null, periodChangePct: null }),
				narrative: null,
				unsubscribeUrl: 'https://trakker.com/unsubscribe?token=abc',
			});

			const call = (sender.send as jest.Mock).mock.calls[0][0];
			expect(call.html).toContain('—');
			expect(call.html).not.toContain('R$ 0,00');
		});

		it('omite a seção de pontos de atenção quando não há watchItems', async () => {
			const { service, sender } = buildService();

			await service.sendPortfolioDigestEmail('investidor@example.com', {
				facts: digestFacts({ watchItems: [] }),
				narrative: null,
				unsubscribeUrl: 'https://trakker.com/unsubscribe?token=abc',
			});

			const call = (sender.send as jest.Mock).mock.calls[0][0];
			expect(call.html).not.toContain('Pontos de atenção');
		});
	});
});
