import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import type { Dashboard } from 'src/advisor/application/attention/dashboard.service';
import {
	DASHBOARD_DEFAULT_DAYS,
	DASHBOARD_MAX_DAYS,
	DASHBOARD_MIN_DAYS,
} from 'src/advisor/application/attention/dashboard.service';
import { AlertResponseDto } from './alert.dto';

export class DashboardQueryDto {
	@ApiPropertyOptional({
		minimum: DASHBOARD_MIN_DAYS,
		maximum: DASHBOARD_MAX_DAYS,
		default: DASHBOARD_DEFAULT_DAYS,
		description: 'Dias da série de evolução',
	})
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(DASHBOARD_MIN_DAYS)
	@Max(DASHBOARD_MAX_DAYS)
	days?: number;
}

export class DashboardWealthDto {
	@ApiProperty({ enum: ['BRL'] })
	currency: 'BRL';

	@ApiProperty({
		type: Number,
		nullable: true,
		description: 'Soma dos snapshots em centavos; nulo sem nenhum snapshot',
	})
	totalMinor: number | null;

	@ApiProperty({ type: Number, nullable: true, description: 'VERIFIED' })
	verifiedMinor: number | null;

	@ApiProperty({ type: Number, nullable: true, description: 'MANUAL' })
	manualMinor: number | null;

	@ApiProperty({
		type: String,
		nullable: true,
		description: 'O asOf mais antigo entre os snapshots, YYYY-MM-DD',
	})
	asOf: string | null;
}

export class DashboardChangeDto {
	@ApiProperty({ enum: ['BRL'] })
	currency: 'BRL';

	@ApiProperty({ description: 'Centavos' })
	deltaMinor: number;

	@ApiProperty({
		type: Number,
		nullable: true,
		description: 'Fração (0.05 = 5%); nula com base zero',
	})
	pct: number | null;

	@ApiProperty({ description: 'Clientes que entraram na soma no período' })
	clientsJoined: number;

	@ApiProperty({ description: 'Clientes que saíram da soma no período' })
	clientsLeft: number;
}

export class OpenAlertCountsDto {
	@ApiProperty()
	P0: number;

	@ApiProperty()
	P1: number;

	@ApiProperty()
	P2: number;

	@ApiProperty()
	P3: number;
}

export class DashboardDeadlineDto {
	@ApiProperty()
	alertId: string;

	@ApiProperty()
	clientProfileId: string;

	@ApiProperty({
		enum: ['DUE', 'SNOOZE_END'],
		description: 'Prazo de alerta manual ou fim de adiamento',
	})
	kind: 'DUE' | 'SNOOZE_END';

	@ApiProperty({ description: 'YYYY-MM-DD' })
	date: string;
}

export class DashboardSeriesPointDto {
	@ApiProperty({ description: 'YYYY-MM-DD' })
	date: string;

	@ApiProperty({ description: 'Soma diária dos snapshots, centavos BRL' })
	totalMinor: number;
}

/** Painel do que o membro vê; só ids de cliente, nenhum nome nem e-mail. */
export class DashboardResponseDto {
	@ApiProperty({ type: DashboardWealthDto })
	wealth: DashboardWealthDto;

	@ApiProperty({
		type: DashboardChangeDto,
		nullable: true,
		description: 'Contra o snapshot de 30 dias atrás; nulo sem essa base',
	})
	change30d: DashboardChangeDto | null;

	@ApiProperty({ description: 'Clientes com snapshot' })
	clients: number;

	@ApiProperty({
		type: OpenAlertCountsDto,
		description: 'Alertas OPEN por prioridade (adiados não contam)',
	})
	openAlerts: OpenAlertCountsDto;

	@ApiProperty({ type: [AlertResponseDto], description: 'Top 5 da fila' })
	topAlerts: AlertResponseDto[];

	@ApiProperty({
		type: [DashboardDeadlineDto],
		description: 'Próximos 14 dias',
	})
	deadlines: DashboardDeadlineDto[];

	@ApiProperty({ type: [DashboardSeriesPointDto] })
	series: DashboardSeriesPointDto[];

	static of(d: Dashboard): DashboardResponseDto {
		return {
			wealth: {
				currency: 'BRL',
				totalMinor: d.wealth.totalMinor,
				verifiedMinor: d.wealth.verifiedMinor,
				manualMinor: d.wealth.manualMinor,
				asOf: d.wealth.asOf,
			},
			change30d: d.change30d && {
				currency: 'BRL',
				deltaMinor: d.change30d.deltaMinor,
				pct: d.change30d.pct,
				clientsJoined: d.change30d.clientsJoined,
				clientsLeft: d.change30d.clientsLeft,
			},
			clients: d.clients,
			openAlerts: {
				P0: d.openAlerts.P0,
				P1: d.openAlerts.P1,
				P2: d.openAlerts.P2,
				P3: d.openAlerts.P3,
			},
			topAlerts: d.topAlerts.map(AlertResponseDto.of),
			deadlines: d.deadlines.map((x) => ({
				alertId: x.alertId,
				clientProfileId: x.clientProfileId,
				kind: x.kind,
				date: x.date,
			})),
			series: d.series.map((p) => ({ date: p.date, totalMinor: p.totalMinor })),
		};
	}
}
