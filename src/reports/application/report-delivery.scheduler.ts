import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EmailService } from 'src/notifications/email/email.service';
import { User } from 'src/users/schema/user.model';
import { REPORT_CATALOG } from 'src/reports/domain/report-catalog';
import { nextRunAt, reportYearFor } from 'src/reports/domain/schedule-calendar';
import { ReportSchedule } from 'src/reports/infrastructure/report-schedule.model';
import { ReportsService } from './reports.service';

/** Relatório com PDF abre um Chromium: poucos por rodada. */
const BATCH_SIZE = 20;

const FREQUENCY_LABEL = {
	weekly: 'semanal',
	monthly: 'mensal',
	quarterly: 'trimestral',
	yearly: 'anual',
} as const;

/**
 * Entrega os relatórios agendados por e-mail, de hora em hora.
 *
 * O `nextRunAt` avança ANTES de gerar (claim atômico com `findOneAndUpdate`):
 * se duas instâncias rodarem juntas, só uma pega cada agendamento, e uma
 * falha não fica repetindo a cada hora — ela vai para `lastError` e a próxima
 * tentativa é a próxima data do calendário.
 */
@Injectable()
export class ReportDeliveryScheduler {
	private readonly logger = new Logger(ReportDeliveryScheduler.name);

	constructor(
		@InjectModel('ReportSchedule')
		private readonly scheduleModel: Model<ReportSchedule>,
		@InjectModel('User') private readonly userModel: Model<User>,
		private readonly reportsService: ReportsService,
		private readonly emailService: EmailService
	) {}

	@Cron('5 * * * *', { timeZone: 'America/Sao_Paulo' })
	async deliverDueReports(now = new Date()): Promise<void> {
		for (let i = 0; i < BATCH_SIZE; i++) {
			const schedule = await this.claimNext(now);
			if (!schedule) return;
			await this.deliver(schedule, now);
		}
	}

	private async claimNext(now: Date): Promise<ReportSchedule | null> {
		const due = await this.scheduleModel
			.findOne({ status: 'active', nextRunAt: { $lte: now } })
			.sort({ nextRunAt: 1 });
		if (!due) return null;
		return this.scheduleModel.findOneAndUpdate(
			{ _id: due._id, nextRunAt: due.nextRunAt, status: 'active' },
			{ $set: { nextRunAt: nextRunAt(due.frequency, now) } },
			{ new: false }
		);
	}

	private async deliver(schedule: ReportSchedule, now: Date): Promise<void> {
		const runAt = schedule.nextRunAt;
		try {
			const user = await this.userModel
				.findById(schedule.userId)
				.select('email')
				.lean<Pick<User, 'email'> | null>();
			if (!user?.email) {
				// Conta apagada: o agendamento órfão sai junto.
				await this.scheduleModel.deleteOne({ _id: schedule._id });
				return;
			}
			const year = reportYearFor(schedule.frequency, runAt);
			const report = await this.reportsService.generate(
				String(schedule.userId),
				schedule.kind,
				schedule.format,
				year
			);
			await this.emailService.sendScheduledReportEmail(user.email, {
				reportTitle: REPORT_CATALOG[schedule.kind].title,
				periodLabel: `${FREQUENCY_LABEL[schedule.frequency]} · ${year}`,
				attachment: { filename: report.filename, content: report.content },
			});
			await this.scheduleModel.updateOne(
				{ _id: schedule._id },
				{ $set: { lastRunAt: now, lastError: null } }
			);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : 'erro desconhecido';
			this.logger.warn(`Agendamento ${schedule._id} falhou: ${message}`);
			await this.scheduleModel.updateOne(
				{ _id: schedule._id },
				{ $set: { lastError: 'Não foi possível gerar ou enviar o relatório.' } }
			);
		}
	}
}
