import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
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

export class DownloadReportQueryDto {
	@ApiProperty({ enum: REPORT_FORMATS, example: 'pdf' })
	@IsIn(REPORT_FORMATS)
	format!: ReportFormat;

	@ApiPropertyOptional({ example: 2026 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(2000)
	@Max(2100)
	year?: number;
}

export class ReportKindParamDto {
	@ApiProperty({ enum: REPORT_KINDS })
	@IsIn(REPORT_KINDS)
	kind!: ReportKind;
}

export class CreateReportScheduleDto {
	@ApiProperty({ enum: REPORT_KINDS })
	@IsIn(REPORT_KINDS)
	kind!: ReportKind;

	@ApiProperty({ enum: REPORT_FORMATS })
	@IsIn(REPORT_FORMATS)
	format!: ReportFormat;

	@ApiProperty({ enum: SCHEDULE_FREQUENCIES })
	@IsIn(SCHEDULE_FREQUENCIES)
	frequency!: ScheduleFrequency;
}

export class UpdateReportScheduleDto {
	@ApiProperty({ enum: ['active', 'paused'] })
	@IsIn(['active', 'paused'])
	status!: 'active' | 'paused';
}
