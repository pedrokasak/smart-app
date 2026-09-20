import { Inject, Injectable } from '@nestjs/common';
import { EMAIL_SENDER, EmailSender } from './ports/email-sender.port';
import { PortfolioDigestFacts } from 'src/notifications/portfolio-digest/domain/portfolio-digest.types';
import { DigestNotificationsSummary } from 'src/notifications/portfolio-digest/domain/digest-notification.types';

// Mesma frase de web/src/components/ui/ai-generated-notice.tsx. Duplicada
// de proposito: o e-mail e backend, repo separado, e servir a string do
// server pro web (ou vice-versa) custaria mais que manter as duas em
// sincronia manualmente — mudam raramente e juntas.
const AI_GENERATED_NOTICE_TEXT =
	'Esse texto foi gerado com o auxílio de inteligência artificial.';

/**
 * Escapa texto antes de interpolar no HTML do e-mail. Usado na seção de
 * avisos da semana (TRA-136, fase 7), cujo texto pode vir de payload com
 * campo livre (`AiInsightHigh.title`/`summary`) ou de `aiSummary`. Nada
 * que atravessou o trackerr-ia entra cru no corpo do e-mail.
 */
function escapeHtml(value: string): string {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

@Injectable()
export class EmailService {
	constructor(@Inject(EMAIL_SENDER) private readonly sender: EmailSender) {}

	private getAppBaseUrl(): string {
		const baseUrl =
			process.env.URL_PRODUCTION ||
			process.env.URL_DEVELOPMENT ||
			'http://localhost:5173';
		return String(baseUrl).replace(/\/+$/, '');
	}

	private getBaseTemplate(params: {
		title: string;
		hero: string;
		description: string;
		ctaLabel: string;
		ctaUrl: string;
		footerNote: string;
	}): string {
		const { title, hero, description, ctaLabel, ctaUrl, footerNote } = params;
		return `
			<div style="margin:0;padding:24px;background:#0b1220;font-family:Arial,sans-serif;color:#e5e7eb;">
				<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:0 auto;background:#111827;border:1px solid #1f2937;border-radius:16px;overflow:hidden;">
					<tr>
						<td style="padding:28px 28px 12px 28px;background:linear-gradient(135deg,#16a34a,#2563eb);">
							<div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#dcfce7;font-weight:700;">Trackerr</div>
							<h1 style="margin:10px 0 0 0;color:#ffffff;font-size:24px;line-height:1.3;">${hero}</h1>
						</td>
					</tr>
					<tr>
						<td style="padding:24px 28px;">
							<h2 style="margin:0 0 12px 0;color:#f9fafb;font-size:18px;">${title}</h2>
							<p style="margin:0 0 20px 0;color:#d1d5db;font-size:14px;line-height:1.6;">${description}</p>
							<a href="${ctaUrl}" style="display:inline-block;padding:12px 18px;background:#22c55e;color:#052e16;text-decoration:none;font-weight:700;border-radius:10px;">
								${ctaLabel}
							</a>
							<p style="margin:20px 0 0 0;color:#9ca3af;font-size:12px;line-height:1.5;">${footerNote}</p>
						</td>
					</tr>
				</table>
			</div>
		`;
	}

	async sendPasswordResetEmail(email: string, token: string): Promise<void> {
		const resetLink = `${this.getAppBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`;

		const subject = 'Redefinição de Senha - Trackerr';
		const html = this.getBaseTemplate({
			title: 'Recuperação de senha',
			hero: 'Solicitação para redefinir sua senha',
			description:
				'Recebemos um pedido para alterar sua senha. Clique no botão abaixo para criar uma nova senha com segurança.',
			ctaLabel: 'Redefinir minha senha',
			ctaUrl: resetLink,
			footerNote:
				'Este link expira em 1 hora. Se você não solicitou, ignore este email com segurança.',
		});
		const text = `Recuperação de Senha - Trackerr\n\nVocê solicitou a redefinição da sua senha.\nAcesse: ${resetLink}\n\nEste link expira em 1 hora.\nSe não foi você, ignore este email.`;

		await this.sender.send({
			to: email,
			subject,
			html,
			text,
		});
	}

	/**
	 * Confirmação de senha alterada (TRA-191).
	 *
	 * Sai depois da troca, não antes: o valor aqui é justamente avisar quem
	 * NÃO trocou. Se a conta foi tomada, este e-mail é o primeiro sinal que
	 * o dono recebe — por isso o texto aponta o caminho de recuperação em
	 * vez de só informar o fato.
	 */
	async sendPasswordChangedEmail(
		email: string,
		firstName?: string
	): Promise<void> {
		const safeName = escapeHtml(String(firstName || 'Investidor').trim());
		const supportLink = `${this.getAppBaseUrl()}/forgot-password`;
		const subject = 'Sua senha do Trackerr foi alterada';
		const html = this.getBaseTemplate({
			title: `Senha alterada, ${safeName}`,
			hero: 'A senha da sua conta foi alterada',
			description:
				'A senha da sua conta no Trackerr acabou de ser alterada com sucesso. ' +
				'Se foi você, não precisa fazer nada.',
			ctaLabel: 'Não fui eu — redefinir senha',
			ctaUrl: supportLink,
			footerNote:
				'Se você não reconhece esta alteração, redefina sua senha imediatamente pelo botão acima e ative a autenticação em dois fatores.',
		});
		const text = `Senha alterada - Trackerr\n\nA senha da sua conta acabou de ser alterada.\nSe não foi você, redefina sua senha agora: ${supportLink}`;

		await this.sender.send({ to: email, subject, html, text });
	}

	/**
	 * Aviso de plano liberado manualmente pelo admin (TRA-186).
	 *
	 * A concessão manual não passa pelo Stripe, então o usuário não recebe
	 * nenhum comprovante de cobrança — sem este e-mail ele simplesmente
	 * descobre o acesso novo por acaso, se entrar no app.
	 */
	async sendPlanGrantedEmail(params: {
		email: string;
		firstName?: string;
		planName: string;
		trialDurationDays?: number;
	}): Promise<void> {
		const safeName = escapeHtml(
			String(params.firstName || 'Investidor').trim()
		);
		const safePlan = escapeHtml(params.planName);
		const dashboardLink = `${this.getAppBaseUrl()}/dashboard`;
		const isTrial =
			typeof params.trialDurationDays === 'number' &&
			params.trialDurationDays > 0;
		const period = isTrial
			? ` O acesso é um teste válido por ${params.trialDurationDays} dia(s).`
			: '';

		const subject = `Seu acesso ao plano ${safePlan} foi liberado — Trackerr`;
		const html = this.getBaseTemplate({
			title: `Plano ${safePlan} liberado, ${safeName}!`,
			hero: 'Seu novo acesso já está ativo',
			description:
				`Liberamos o plano <strong>${safePlan}</strong> na sua conta do Trackerr.${period} ` +
				'Todos os recursos do plano já estão disponíveis — é só entrar.',
			ctaLabel: 'Acessar meu dashboard',
			ctaUrl: dashboardLink,
			footerNote: isTrial
				? 'Ao fim do período de teste o acesso volta ao plano gratuito, sem cobrança automática.'
				: 'Esta liberação foi feita pela nossa equipe e não gera cobrança.',
		});
		const text = `Plano ${params.planName} liberado - Trackerr\n\nSeu acesso já está ativo.${period}\nAcesse: ${dashboardLink}`;

		await this.sender.send({ to: params.email, subject, html, text });
	}

	async sendWelcomeEmail(email: string, firstName?: string): Promise<void> {
		const dashboardLink = `${this.getAppBaseUrl()}/dashboard`;
		const safeName = String(firstName || 'Investidor').trim();
		const subject = `Bem-vindo(a) ao Trackerr, ${safeName}!`;
		const html = this.getBaseTemplate({
			title: `Conta criada com sucesso, ${safeName}!`,
			hero: 'Seu novo painel de investimentos está pronto',
			description:
				'Obrigado por se cadastrar no Trackerr. Agora você já pode conectar suas contas, importar sua carteira e acompanhar seus resultados em tempo real.',
			ctaLabel: 'Acessar meu dashboard',
			ctaUrl: dashboardLink,
			footerNote:
				'Dica: ative a autenticação em dois fatores para aumentar a segurança da sua conta.',
		});
		const text = `Bem-vindo(a) ao Trackerr, ${safeName}!\n\nSua conta foi criada com sucesso.\nAcesse seu dashboard: ${dashboardLink}\n\nBons investimentos!`;

		await this.sender.send({
			to: email,
			subject,
			html,
			text,
		});
	}

	async sendScheduledReportEmail(
		email: string,
		params: {
			reportTitle: string;
			periodLabel: string;
			attachment: { filename: string; content: Buffer };
		}
	): Promise<void> {
		const reportsLink = `${this.getAppBaseUrl()}/reports`;
		const html = this.getBaseTemplate({
			title: `${escapeHtml(params.reportTitle)} · ${escapeHtml(params.periodLabel)}`,
			hero: 'Seu relatório agendado chegou',
			description: `O arquivo ${escapeHtml(params.attachment.filename)} está em anexo, gerado com os dados da sua conta.`,
			ctaLabel: 'Gerenciar agendamentos',
			ctaUrl: reportsLink,
			footerNote:
				'Você recebe este e-mail porque agendou o relatório no Trackerr. Pause ou apague o agendamento na tela Relatórios.',
		});
		const text = `${params.reportTitle} (${params.periodLabel}) em anexo.\nGerencie seus agendamentos: ${reportsLink}`;

		await this.sender.send({
			to: email,
			subject: `${params.reportTitle} · ${params.periodLabel} — Trackerr`,
			html,
			text,
			attachments: [params.attachment],
		});
	}

	async sendPurchaseIntentConfirmationEmail(
		email: string,
		planName: string
	): Promise<void> {
		const subject = `Recebemos seu interesse no plano ${planName} - Trackerr`;
		const html = this.getBaseTemplate({
			title: `Interesse registrado: ${planName}`,
			hero: 'Estamos finalizando os acessos para o seu setor',
			description: `Recebemos seu interesse no plano ${planName}. Nossa equipe está priorizando os próximos convites — você vai receber um e-mail assim que seu acesso estiver liberado.`,
			ctaLabel: 'Conhecer o Trackerr',
			ctaUrl: this.getAppBaseUrl(),
			footerNote:
				'Se você não solicitou este contato, pode ignorar este e-mail com segurança.',
		});
		const text = `Interesse registrado: ${planName}\n\nRecebemos seu interesse no plano ${planName}. Você vai receber um e-mail assim que seu acesso estiver liberado.`;

		await this.sender.send({
			to: email,
			subject,
			html,
			text,
		});
	}

	async sendPortfolioDigestEmail(
		email: string,
		params: {
			facts: PortfolioDigestFacts;
			/** null = fallback determinístico. Nunca anuncia AiGeneratedNotice nesse caso. */
			narrative: string | null;
			/**
			 * "O que avisamos nesta semana" (TRA-136, fase 7). Bloco
			 * DETERMINISTICO: o texto vem dos mesmos templates do centro in-app
			 * e nunca passa pelo narrador. Ausente/vazio = a seção some do
			 * e-mail, sem título órfão.
			 */
			weekNotifications?: DigestNotificationsSummary;
			unsubscribeUrl: string;
			firstName?: string;
		}
	): Promise<void> {
		const { facts, narrative, unsubscribeUrl, firstName } = params;
		const weekNotifications = params.weekNotifications ?? {
			items: [],
			omitted: 0,
		};
		const safeName = String(firstName || 'Investidor').trim();
		const subject = 'Seu resumo semanal de carteira — Trackerr';

		const money = (value: number | null) =>
			value === null
				? '—'
				: new Intl.NumberFormat('pt-BR', {
						style: 'currency',
						currency: 'BRL',
					}).format(value);

		const changeLabel =
			facts.periodChangePct === null
				? null
				: `${facts.periodChangePct >= 0 ? '+' : ''}${facts.periodChangePct.toFixed(2)}%`;
		const changeColor =
			facts.periodChangePct === null
				? '#9ca3af'
				: facts.periodChangePct >= 0
					? '#4ade80'
					: '#fb7185';

		const moversRow = (
			label: string,
			movers: PortfolioDigestFacts['topGainers']
		) =>
			movers.length === 0
				? ''
				: `<p style="margin:0 0 6px 0;color:#d1d5db;font-size:13px;">
					<strong style="color:#f9fafb;">${label}:</strong>
					${movers
						.map(
							(m) =>
								`${m.symbol} (${m.changePercent >= 0 ? '+' : ''}${m.changePercent.toFixed(2)}%)`
						)
						.join(', ')}
				</p>`;

		const watchItemsHtml = facts.watchItems
			.map(
				(item) =>
					`<li style="margin:0 0 6px 0;color:#d1d5db;font-size:13px;">${item.detail}</li>`
			)
			.join('');

		const narrativeHtml = narrative
			? `<p style="margin:0 0 4px 0;color:#e5e7eb;font-size:14px;line-height:1.6;">${narrative}</p>
				<p style="margin:0 0 20px 0;color:#9ca3af;font-size:11px;">${AI_GENERATED_NOTICE_TEXT}</p>`
			: '';

		const omittedLine =
			weekNotifications.omitted > 0
				? `E mais ${weekNotifications.omitted} aviso${
						weekNotifications.omitted === 1 ? '' : 's'
					} no período — veja todos no seu centro de notificações.`
				: '';

		/**
		 * Bloco deterministico, renderizado DEPOIS da narrativa: o que a IA
		 * escreveu fica claramente delimitado acima, e esta lista abaixo é
		 * template puro. O aviso de texto gerado por IA não se estende até
		 * aqui — `aiSummary`, quando usado, já veio marcado como tal no
		 * momento em que foi gerado, e o item continua sendo um fato ("nós te
		 * avisamos isto"), não prosa nova.
		 */
		const weekNotificationsHtml =
			weekNotifications.items.length === 0
				? ''
				: `<div style="margin:20px 0 0 0;padding:16px;background:#0b1220;border:1px solid #1f2937;border-radius:12px;">
						<p style="margin:0 0 10px 0;color:#f9fafb;font-size:13px;font-weight:700;">O que avisamos nesta semana</p>
						<ul style="margin:0;padding-left:18px;">
							${weekNotifications.items
								.map(
									(item) =>
										`<li style="margin:0 0 8px 0;color:#d1d5db;font-size:13px;line-height:1.5;">
											<strong style="color:#f9fafb;">${escapeHtml(item.title)}</strong>${
												item.body ? `<br />${escapeHtml(item.body)}` : ''
											}
										</li>`
								)
								.join('')}
						</ul>
						${
							omittedLine
								? `<p style="margin:8px 0 0 0;color:#9ca3af;font-size:12px;">${escapeHtml(omittedLine)}</p>`
								: ''
						}
					</div>`;

		const html = `
			<div style="margin:0;padding:24px;background:#0b1220;font-family:Arial,sans-serif;color:#e5e7eb;">
				<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:0 auto;background:#111827;border:1px solid #1f2937;border-radius:16px;overflow:hidden;">
					<tr>
						<td style="padding:28px 28px 12px 28px;background:linear-gradient(135deg,#16a34a,#2563eb);">
							<div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#dcfce7;font-weight:700;">Trackerr</div>
							<h1 style="margin:10px 0 0 0;color:#ffffff;font-size:22px;line-height:1.3;">Resumo semanal da sua carteira</h1>
						</td>
					</tr>
					<tr>
						<td style="padding:24px 28px;">
							<p style="margin:0 0 20px 0;color:#d1d5db;font-size:14px;">Olá, ${safeName}. Aqui está o que aconteceu de ${facts.periodStart} a ${facts.periodEnd}.</p>

							<div style="margin:0 0 20px 0;padding:16px;background:#0b1220;border:1px solid #1f2937;border-radius:12px;">
								<div style="font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Patrimônio atual</div>
								<div style="font-size:26px;font-weight:700;color:#f9fafb;margin-top:4px;">${money(facts.portfolioValue)}</div>
								${changeLabel ? `<div style="font-size:13px;color:${changeColor};margin-top:4px;">${changeLabel} no período</div>` : ''}
							</div>

							${narrativeHtml}

							${moversRow('Altas do dia', facts.topGainers)}
							${moversRow('Baixas do dia', facts.topLosers)}

							${
								facts.watchItems.length > 0
									? `<div style="margin:16px 0;">
										<p style="margin:0 0 8px 0;color:#f9fafb;font-size:13px;font-weight:700;">Pontos de atenção</p>
										<ul style="margin:0;padding-left:18px;">${watchItemsHtml}</ul>
									</div>`
									: ''
							}

							${
								facts.dividendsReceived !== null && facts.dividendsReceived > 0
									? `<p style="margin:16px 0 0 0;color:#d1d5db;font-size:13px;">Dividendos recebidos no período: <strong style="color:#f9fafb;">${money(facts.dividendsReceived)}</strong></p>`
									: ''
							}

							${weekNotificationsHtml}

							<p style="margin:28px 0 0 0;color:#6b7280;font-size:11px;line-height:1.5;">
								Você recebe este e-mail porque ativou o resumo semanal.
								<a href="${unsubscribeUrl}" style="color:#9ca3af;text-decoration:underline;">Cancelar envio</a>
							</p>
						</td>
					</tr>
				</table>
			</div>
		`;

		const text = [
			`Resumo semanal da carteira — ${facts.periodStart} a ${facts.periodEnd}`,
			`Patrimônio atual: ${money(facts.portfolioValue)}${changeLabel ? ` (${changeLabel} no período)` : ''}`,
			narrative ? `\n${narrative}\n(${AI_GENERATED_NOTICE_TEXT})` : '',
			facts.topGainers.length > 0
				? `Altas do dia: ${facts.topGainers.map((m) => `${m.symbol} (${m.changePercent.toFixed(2)}%)`).join(', ')}`
				: '',
			facts.topLosers.length > 0
				? `Baixas do dia: ${facts.topLosers.map((m) => `${m.symbol} (${m.changePercent.toFixed(2)}%)`).join(', ')}`
				: '',
			facts.watchItems.length > 0
				? `Pontos de atenção: ${facts.watchItems.map((w) => w.detail).join(' | ')}`
				: '',
			facts.dividendsReceived !== null && facts.dividendsReceived > 0
				? `Dividendos recebidos: ${money(facts.dividendsReceived)}`
				: '',
			weekNotifications.items.length > 0
				? [
						'',
						'O que avisamos nesta semana:',
						...weekNotifications.items.map((item) =>
							item.body ? `- ${item.title}: ${item.body}` : `- ${item.title}`
						),
						omittedLine,
					]
						.filter(Boolean)
						.join('\n')
				: '',
			`\nCancelar envio: ${unsubscribeUrl}`,
		]
			.filter(Boolean)
			.join('\n');

		await this.sender.send({
			to: email,
			subject,
			html,
			text,
		});
	}
}
