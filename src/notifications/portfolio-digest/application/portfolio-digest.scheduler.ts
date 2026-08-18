import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from 'src/users/schema/user.model';
import { SubscriptionService } from 'src/subscription/subscription.service';
import { EmailService } from 'src/notifications/email/email.service';
import { PortfolioDigestBuilderService } from 'src/notifications/portfolio-digest/application/portfolio-digest-builder.service';
import { DigestUnsubscribeTokenService } from 'src/notifications/portfolio-digest/application/digest-unsubscribe-token.service';
import {
	DIGEST_NARRATOR,
	DigestNarratorPort,
} from 'src/notifications/portfolio-digest/application/digest-narrator.port';
import { urlProduction, urlDevelopment } from 'src/env';

const IDEMPOTENCY_WINDOW_DAYS = 6;

/**
 * Digest semanal de carteira. Roda 09:00 de segunda (America/Sao_Paulo),
 * bem depois de CleanupService.recordDailyPortfolioSnapshots (00:30), pra
 * garantir que o snapshot do dia ja existe quando o builder le o historico.
 *
 * Falha por usuario isolada com allSettled — mesmo padrao do snapshot
 * diario. Falha de envio loga e nao tenta de novo: na cadencia semanal,
 * retry e nao-retry chegam no mesmo lugar (o proximo cron ja e o proximo
 * digest).
 */
@Injectable()
export class PortfolioDigestScheduler {
	private readonly logger = new Logger(PortfolioDigestScheduler.name);

	constructor(
		@InjectModel('User') private readonly userModel: Model<User>,
		private readonly builder: PortfolioDigestBuilderService,
		@Inject(DIGEST_NARRATOR) private readonly narrator: DigestNarratorPort,
		private readonly emailService: EmailService,
		private readonly tokenService: DigestUnsubscribeTokenService,
		private readonly subscriptionService: SubscriptionService
	) {}

	@Cron('0 9 * * 1', { timeZone: 'America/Sao_Paulo' })
	async sendWeeklyDigests(): Promise<void> {
		const optedIn = await this.userModel.find({
			'notificationPreferences.portfolioDigest.enabled': true,
		});

		const cutoff = new Date();
		cutoff.setDate(cutoff.getDate() - IDEMPOTENCY_WINDOW_DAYS);

		const eligible = optedIn.filter((user) => {
			const lastSent =
				user.notificationPreferences?.portfolioDigest?.lastDigestSentAt;
			return !lastSent || lastSent < cutoff;
		});

		this.logger.log(
			`Digest semanal: ${eligible.length}/${optedIn.length} usuários elegíveis.`
		);

		const results = await Promise.allSettled(
			eligible.map((user) => this.sendDigestForUser(user))
		);

		const failures = results.filter((r) => r.status === 'rejected').length;
		if (failures > 0) {
			this.logger.warn(`Digest semanal: ${failures} falha(s) isolada(s).`);
		}
	}

	private async sendDigestForUser(user: User): Promise<void> {
		const userId = (user as any)._id.toString();
		try {
			const facts = await this.builder.build(userId);
			if (!facts.hasSufficientData) {
				return;
			}

			const isPaidUser = await this.isPaidUser(userId);
			const narrative = isPaidUser ? await this.narrator.narrate(facts) : null;

			const unsubscribeToken = this.tokenService.sign(userId);
			const unsubscribeUrl = `${this.resolveApiBaseUrl()}/notifications/digest/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;

			await this.emailService.sendPortfolioDigestEmail(user.email, {
				facts,
				narrative,
				unsubscribeUrl,
				firstName: user.firstName,
			});

			await this.userModel.findByIdAndUpdate(userId, {
				$set: {
					'notificationPreferences.portfolioDigest.lastDigestSentAt':
						new Date(),
				},
			});
		} catch (error: any) {
			this.logger.error(
				`Falha ao enviar digest para usuário ${userId}: ${error?.message}`
			);
			throw error;
		}
	}

	private async isPaidUser(userId: string): Promise<boolean> {
		try {
			const subscription =
				await this.subscriptionService.findUserSubscription(userId);
			return subscription?.status === 'active';
		} catch {
			return false;
		}
	}

	private resolveApiBaseUrl(): string {
		const baseUrl = urlProduction || urlDevelopment || 'http://localhost:3000';
		return String(baseUrl).replace(/\/+$/, '');
	}
}
