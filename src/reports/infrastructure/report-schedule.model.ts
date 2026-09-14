import { Document, Schema, Types } from 'mongoose';
import {
	REPORT_FORMATS,
	REPORT_KINDS,
	ReportFormat,
	ReportKind,
} from 'src/reports/domain/report-catalog';
import {
	SCHEDULE_FREQUENCIES,
	ScheduleFrequency,
} from 'src/reports/domain/schedule-calendar';

export type ReportScheduleStatus = 'active' | 'paused';

export interface ReportSchedule extends Document {
	userId: Types.ObjectId;
	kind: ReportKind;
	format: ReportFormat;
	frequency: ScheduleFrequency;
	status: ReportScheduleStatus;
	nextRunAt: Date;
	lastRunAt?: Date | null;
	lastError?: string | null;
	pausedAt?: Date | null;
	createdAt?: Date;
	updatedAt?: Date;
}

export const reportScheduleSchema = new Schema<ReportSchedule>(
	{
		userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
		kind: { type: String, enum: REPORT_KINDS, required: true },
		format: { type: String, enum: REPORT_FORMATS, required: true },
		frequency: { type: String, enum: SCHEDULE_FREQUENCIES, required: true },
		status: { type: String, enum: ['active', 'paused'], default: 'active' },
		nextRunAt: { type: Date, required: true },
		lastRunAt: { type: Date, default: null },
		lastError: { type: String, default: null },
		pausedAt: { type: Date, default: null },
	},
	{ timestamps: true }
);

reportScheduleSchema.index(
	{ userId: 1, kind: 1, frequency: 1 },
	{ unique: true }
);
reportScheduleSchema.index({ status: 1, nextRunAt: 1 });
