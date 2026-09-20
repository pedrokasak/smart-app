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

	// TRA-191: os dois avisos que não existiam. O usuário trocava a senha e
	// recebia silêncio; o admin liberava um plano e o usuário só descobria
	// por acaso ao entrar no app.
	describe('sendPasswordChangedEmail', () => {
		it('avisa a troca e oferece o caminho de recuperação para quem não reconhece', async () => {
			const { service, sender } = buildService();

			await service.sendPasswordChangedEmail('investidor@example.com', 'Pedro');

			expect(sender.send).toHaveBeenCalledWith(
				expect.objectContaining({
					to: 'investidor@example.com',
					subject: expect.stringContaining('alterada'),
					html: expect.stringContaining('forgot-password'),
				})
			);
		});

		it('usa um nome neutro quando o cadastro não tem firstName', async () => {
			const { service, sender } = buildService();

			await service.sendPasswordChangedEmail('investidor@example.com');

			const payload = (sender.send as jest.Mock).mock.calls[0][0];
			expect(payload.html).toContain('Investidor');
		});

		it('escapa o nome para não injetar HTML no corpo do e-mail', async () => {
			const { service, sender } = buildService();

			await service.sendPasswordChangedEmail(
				'investidor@example.com',
				'<script>alert(1)</script>'
			);

			const payload = (sender.send as jest.Mock).mock.calls[0][0];
			expect(payload.html).not.toContain('<script>');
			expect(payload.html).toContain('&lt;script&gt;');
		});
	});

	describe('sendPlanGrantedEmail', () => {
		it('nomeia o plano liberado e leva ao dashboard', async () => {
			const { service, sender } = buildService();

			await service.sendPlanGrantedEmail({
				email: 'investidor@example.com',
				firstName: 'Pedro',
				planName: 'Wealth',
			});

			expect(sender.send).toHaveBeenCalledWith(
				expect.objectContaining({
					to: 'investidor@example.com',
					subject: expect.stringContaining('Wealth'),
					html: expect.stringContaining('/dashboard'),
				})
			);
		});

		it('informa o prazo quando a concessão é um teste', async () => {
			const { service, sender } = buildService();

			await service.sendPlanGrantedEmail({
				email: 'investidor@example.com',
				planName: 'Pro',
				trialDurationDays: 14,
			});

			const payload = (sender.send as jest.Mock).mock.calls[0][0];
			expect(payload.html).toContain('14 dia(s)');
			expect(payload.html).toContain('volta ao plano gratuito');
		});

		it('não promete prazo nenhum quando a concessão é permanente', async () => {
			const { service, sender } = buildService();

			await service.sendPlanGrantedEmail({
				email: 'investidor@example.com',
				planName: 'Pro',
			});

			const payload = (sender.send as jest.Mock).mock.calls[0][0];
			expect(payload.html).not.toContain('dia(s)');
			expect(payload.html).toContain('não gera cobrança');
		});
	});

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

		describe('seção "O que avisamos nesta semana" (TRA-136 fase 7)', () => {
			it('renderiza os avisos da semana no HTML e no texto', async () => {
				const { service, sender } = buildService();

				await service.sendPortfolioDigestEmail('investidor@example.com', {
					facts: digestFacts(),
					narrative: null,
					weekNotifications: {
						items: [
							{
								type: 'allocation_breached',
								title: 'Alocacao acima da meta em FIIs',
								body: 'Sua exposicao em FIIs esta em 40.0%.',
								occurredAt: '2026-08-12T12:00:00.000Z',
							},
						],
						omitted: 0,
					},
					unsubscribeUrl: 'https://trakker.com/unsubscribe?token=abc',
				});

				const call = (sender.send as jest.Mock).mock.calls[0][0];
				expect(call.html).toContain('O que avisamos nesta semana');
				expect(call.html).toContain('Alocacao acima da meta em FIIs');
				expect(call.text).toContain('O que avisamos nesta semana:');
				expect(call.text).toContain('- Alocacao acima da meta em FIIs');
			});

			it('semana vazia: nem título órfão nem lista vazia', async () => {
				const { service, sender } = buildService();

				await service.sendPortfolioDigestEmail('investidor@example.com', {
					facts: digestFacts(),
					narrative: null,
					weekNotifications: { items: [], omitted: 0 },
					unsubscribeUrl: 'https://trakker.com/unsubscribe?token=abc',
				});

				const call = (sender.send as jest.Mock).mock.calls[0][0];
				expect(call.html).not.toContain('O que avisamos nesta semana');
				expect(call.text).not.toContain('O que avisamos nesta semana');
			});

			it('sem o campo, o digest sai exatamente como antes', async () => {
				const { service, sender } = buildService();

				await service.sendPortfolioDigestEmail('investidor@example.com', {
					facts: digestFacts(),
					narrative: null,
					unsubscribeUrl: 'https://trakker.com/unsubscribe?token=abc',
				});

				const call = (sender.send as jest.Mock).mock.calls[0][0];
				expect(call.html).not.toContain('O que avisamos nesta semana');
			});

			it('diz quantas ficaram de fora quando o teto corta a lista', async () => {
				const { service, sender } = buildService();

				await service.sendPortfolioDigestEmail('investidor@example.com', {
					facts: digestFacts(),
					narrative: null,
					weekNotifications: {
						items: [
							{
								type: 'dividend_received',
								title: 'Novo dividendo de PETR4',
								body: 'Foi creditado R$ 10,00.',
								occurredAt: '2026-08-12T12:00:00.000Z',
							},
						],
						omitted: 39,
					},
					unsubscribeUrl: 'https://trakker.com/unsubscribe?token=abc',
				});

				const call = (sender.send as jest.Mock).mock.calls[0][0];
				expect(call.html).toContain('E mais 39 avisos no período');
			});

			it('escapa HTML vindo de texto livre (payload de insight / aiSummary)', async () => {
				const { service, sender } = buildService();

				await service.sendPortfolioDigestEmail('investidor@example.com', {
					facts: digestFacts(),
					narrative: null,
					weekNotifications: {
						items: [
							{
								type: 'ai_insight_high',
								title: '<script>alert(1)</script>',
								body: 'ok',
								occurredAt: '2026-08-12T12:00:00.000Z',
							},
						],
						omitted: 0,
					},
					unsubscribeUrl: 'https://trakker.com/unsubscribe?token=abc',
				});

				const call = (sender.send as jest.Mock).mock.calls[0][0];
				expect(call.html).not.toContain('<script>');
				expect(call.html).toContain('&lt;script&gt;');
			});
		});
	});
});
