import {
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
	REPORT_CATALOG,
	ReportFormat,
	ReportKind,
	isFormatAllowed,
} from 'src/reports/domain/report-catalog';
import {
	ScheduleFrequency,
	nextRunAt,
} from 'src/reports/domain/schedule-calendar';
import { ReportSchedule } from 'src/reports/infrastructure/report-schedule.model';

/** Um por relatório × frequência já limita a 24; o teto segura abuso de envio. */
export const MAX_SCHEDULES_PER_USER = 10;

export interface ReportScheduleView {
	id: string;
	kind: ReportKind;
	title: string;
	format: ReportFormat;
	frequency: ScheduleFrequency;
	status: 'active' | 'paused';
	nextRunAt: string | null;
	lastRunAt: string | null;
	lastError: string | null;
	pausedAt: string | null;
}

const toView = (schedule: ReportSchedule): ReportScheduleView => ({
	id: String(schedule._id),
	kind: schedule.kind,
	title: REPORT_CATALOG[schedule.kind].title,
	format: schedule.format,
	frequency: schedule.frequency,
	status: schedule.status,
	nextRunAt:
		schedule.status === 'active' ? schedule.nextRunAt.toISOString() : null,
	lastRunAt: schedule.lastRunAt ? schedule.lastRunAt.toISOString() : null,
	lastError: schedule.lastError ?? null,
	pausedAt: schedule.pausedAt ? schedule.pausedAt.toISOString() : null,
});

@Injectable()
export class ReportSchedulesService {
	constructor(
		@InjectModel('ReportSchedule')
		private readonly scheduleModel: Model<ReportSchedule>
	) {}

	async list(userId: string): Promise<ReportScheduleView[]> {
		const schedules = await this.scheduleModel
			.find({ userId: new Types.ObjectId(userId) })
			.sort({ createdAt: 1 });
		return schedules.map(toView);
	}

	async create(
		userId: string,
		input: {
			kind: ReportKind;
			format: ReportFormat;
			frequency: ScheduleFrequency;
		},
		now = new Date()
	): Promise<ReportScheduleView> {
		if (!isFormatAllowed(input.kind, input.format)) {
			throw new BadRequestException(
				`${REPORT_CATALOG[input.kind].title} não está disponível em ${input.format.toUpperCase()}.`
			);
		}
		const objectUserId = new Types.ObjectId(userId);
		const count = await this.scheduleModel.countDocuments({
			userId: objectUserId,
		});
		if (count >= MAX_SCHEDULES_PER_USER) {
			throw new BadRequestException(
				`Limite de ${MAX_SCHEDULES_PER_USER} agendamentos atingido.`
			);
		}
		try {
			const created = await this.scheduleModel.create({
				userId: objectUserId,
				...input,
				status: 'active',
				nextRunAt: nextRunAt(input.frequency, now),
			});
			return toView(created);
		} catch (error) {
			if ((error as { code?: number })?.code === 11000) {
				throw new ConflictException(
					'Esse relatório já tem um agendamento com essa frequência.'
				);
			}
			throw error;
		}
	}

	async setStatus(
		userId: string,
		id: string,
		status: 'active' | 'paused',
		now = new Date()
	): Promise<ReportScheduleView> {
		const schedule = await this.findOwned(userId, id);
		schedule.status = status;
		if (status === 'paused') {
			schedule.pausedAt = now;
		} else {
			schedule.pausedAt = null;
			// Retomar não despeja as entregas perdidas durante a pausa.
			schedule.nextRunAt = nextRunAt(schedule.frequency, now);
		}
		await schedule.save();
		return toView(schedule);
	}

	async remove(userId: string, id: string): Promise<void> {
		const schedule = await this.findOwned(userId, id);
		await schedule.deleteOne();
	}

	private async findOwned(userId: string, id: string): Promise<ReportSchedule> {
		// Id inválido ou de outro usuário respondem igual: não revela existência.
		const schedule = Types.ObjectId.isValid(id)
			? await this.scheduleModel.findOne({
					_id: id,
					userId: new Types.ObjectId(userId),
				})
			: null;
		if (!schedule) throw new NotFoundException('Agendamento não encontrado.');
		return schedule;
	}
}
