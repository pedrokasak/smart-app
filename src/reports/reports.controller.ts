import {
	Body,
	Controller,
	Delete,
	ForbiddenException,
	Get,
	HttpCode,
	Param,
	Patch,
	Post,
	Query,
	Req,
	Res,
	UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { ReportSchedulesService } from './application/report-schedules.service';
import { ReportsService } from './application/reports.service';
import {
	CreateReportScheduleDto,
	DownloadReportQueryDto,
	ReportKindParamDto,
	UpdateReportScheduleDto,
} from './dto/report.dto';
import { RequiresCapability } from 'src/subscription/capabilities/requires-capability.decorator';

import { OwnershipChecked } from 'src/auth/decorators/ownership.decorator';
function requireUserId(req: any): string {
	const userId = req.user?.userId ?? req.user?.sub;
	if (!userId) throw new ForbiddenException('Usuário não autenticado.');
	return String(userId);
}

/** Relatórios e agendamentos do usuário do token (TRA-171). */
@RequiresCapability('reports.export')
@Controller('reports')
@ApiTags('reports')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class ReportsController {
	constructor(
		private readonly reportsService: ReportsService,
		private readonly schedulesService: ReportSchedulesService
	) {}

	@Get('schedules')
	@ApiOperation({ summary: 'Agendamentos de relatório do usuário' })
	listSchedules(@Req() req: any) {
		return this.schedulesService.list(requireUserId(req));
	}

	@Post('schedules')
	@ApiOperation({ summary: 'Agenda a entrega de um relatório por e-mail' })
	createSchedule(@Req() req: any, @Body() dto: CreateReportScheduleDto) {
		return this.schedulesService.create(requireUserId(req), dto);
	}

	@OwnershipChecked('ReportSchedulesService.findOwned')
	@Patch('schedules/:id')
	@ApiOperation({ summary: 'Pausa ou retoma um agendamento' })
	updateSchedule(
		@Req() req: any,
		@Param('id') id: string,
		@Body() dto: UpdateReportScheduleDto
	) {
		return this.schedulesService.setStatus(requireUserId(req), id, dto.status);
	}

	@OwnershipChecked('ReportSchedulesService.findOwned')
	@Delete('schedules/:id')
	@HttpCode(204)
	@ApiOperation({ summary: 'Apaga um agendamento' })
	async deleteSchedule(@Req() req: any, @Param('id') id: string) {
		await this.schedulesService.remove(requireUserId(req), id);
	}

	@OwnershipChecked('relatório gerado para o userId do token')
	@Get(':kind/download')
	@ApiOperation({ summary: 'Gera e baixa um relatório' })
	async download(
		@Req() req: any,
		@Param() params: ReportKindParamDto,
		@Query() query: DownloadReportQueryDto,
		@Res() res: Response
	) {
		const report = await this.reportsService.generate(
			requireUserId(req),
			params.kind,
			query.format,
			query.year ?? new Date().getFullYear()
		);
		res.setHeader('Content-Type', report.contentType);
		res.setHeader(
			'Content-Disposition',
			`attachment; filename="${report.filename}"`
		);
		res.setHeader('Content-Length', report.content.length.toString());
		res.setHeader('Cache-Control', 'no-store');
		return res.send(report.content);
	}
}
