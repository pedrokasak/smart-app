import {
	BadRequestException,
	ConflictException,
	NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import {
	MAX_SCHEDULES_PER_USER,
	ReportSchedulesService,
} from './report-schedules.service';
import { ReportsService } from './reports.service';

const userId = new Types.ObjectId().toString();
const now = new Date('2026-09-14T15:00:00Z');

describe('ReportSchedulesService', () => {
	const model = {
		find: jest.fn(),
		countDocuments: jest.fn(),
		create: jest.fn(),
		findOne: jest.fn(),
	};
	const service = new ReportSchedulesService(model as any);

	beforeEach(() => {
		jest.resetAllMocks();
		model.countDocuments.mockResolvedValue(0);
		model.create.mockImplementation(async (doc) => ({
			_id: new Types.ObjectId(),
			...doc,
		}));
	});

	it('creates an active schedule with the next calendar run', async () => {
		const view = await service.create(
			userId,
			{ kind: 'portfolio', format: 'pdf', frequency: 'monthly' },
			now
		);

		expect(view).toMatchObject({
			kind: 'portfolio',
			title: 'Carteira consolidada',
			status: 'active',
			nextRunAt: '2026-10-01T11:00:00.000Z',
		});
	});

	it('rejects a format the report does not offer', async () => {
		await expect(
			service.create(
				userId,
				{ kind: 'risk', format: 'csv', frequency: 'monthly' },
				now
			)
		).rejects.toThrow(BadRequestException);
		expect(model.create).not.toHaveBeenCalled();
	});

	it('caps schedules per user', async () => {
		model.countDocuments.mockResolvedValue(MAX_SCHEDULES_PER_USER);

		await expect(
			service.create(
				userId,
				{ kind: 'fiscal', format: 'pdf', frequency: 'yearly' },
				now
			)
		).rejects.toThrow(BadRequestException);
	});

	it('turns a duplicate into a conflict', async () => {
		model.create.mockRejectedValue({ code: 11000 });

		await expect(
			service.create(
				userId,
				{ kind: 'fiscal', format: 'pdf', frequency: 'yearly' },
				now
			)
		).rejects.toThrow(ConflictException);
	});

	it('only touches schedules owned by the user', async () => {
		model.findOne.mockResolvedValue(null);

		await expect(
			service.remove(userId, new Types.ObjectId().toString())
		).rejects.toThrow(NotFoundException);
		await expect(service.remove(userId, 'not-an-id')).rejects.toThrow(
			NotFoundException
		);
		expect(model.findOne.mock.calls[0][0].userId.toString()).toBe(userId);
	});

	it('resuming recomputes the next run instead of replaying missed ones', async () => {
		const schedule = {
			_id: new Types.ObjectId(),
			kind: 'operations',
			format: 'csv',
			frequency: 'weekly',
			status: 'paused',
			nextRunAt: new Date('2026-01-05T11:00:00Z'),
			pausedAt: new Date('2026-01-01T00:00:00Z'),
			save: jest.fn(),
		};
		model.findOne.mockResolvedValue(schedule);

		const view = await service.setStatus(
			userId,
			String(schedule._id),
			'active',
			now
		);

		expect(view.nextRunAt).toBe('2026-09-21T11:00:00.000Z');
		expect(view.pausedAt).toBeNull();
		expect(schedule.save).toHaveBeenCalled();
	});
});

describe('ReportsService', () => {
	it('refuses a format outside the catalog before building anything', async () => {
		const builder = { build: jest.fn() };
		const service = new ReportsService(builder as any);

		await expect(
			service.generate(userId, 'accountant', 'pdf', 2026)
		).rejects.toThrow(BadRequestException);
		expect(builder.build).not.toHaveBeenCalled();
	});

	it('names the file after the report and year', async () => {
		const builder = {
			build: jest.fn().mockResolvedValue({
				title: 'Extrato',
				subtitle: '',
				summary: [],
				tables: [{ title: 'Operações', columns: [], rows: [] }],
				notes: [],
			}),
		};
		const service = new ReportsService(builder as any);

		const report = await service.generate(userId, 'operations', 'csv', 2025);

		expect(report.filename).toBe('extrato-de-operacoes-2025.csv');
		expect(report.contentType).toContain('text/csv');
		expect(builder.build).toHaveBeenCalledWith(userId, 'operations', 2025);
	});
});
