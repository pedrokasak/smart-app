import {
	FREE_ACCESS_LEVEL,
	PRO_ACCESS_LEVEL,
	UserPlanResolverPort,
} from 'src/subscription/application/user-plan.types';
import {
	PLAN_REQUIRED_ERROR,
	ReportDeliveryScheduler,
} from './report-delivery.scheduler';

/**
 * O envio agendado roda fora de HTTP, então o `@RequiresCapability` do
 * controller não o alcança (TRA-193). Estes testes garantem que o job aplica
 * a mesma regra `reports.export`.
 */
describe('ReportDeliveryScheduler — gate de plano', () => {
	const now = new Date('2026-09-24T12:00:00Z');
	const schedule = {
		_id: 's-1',
		userId: 'u-1',
		kind: 'portfolio',
		format: 'pdf',
		frequency: 'monthly',
		status: 'active',
		nextRunAt: new Date('2026-09-24T11:00:00Z'),
	};

	let scheduleModel: any;
	let userModel: any;
	let reportsService: { generate: jest.Mock };
	let emailService: { sendScheduledReportEmail: jest.Mock };
	let resolver: jest.Mocked<UserPlanResolverPort>;
	let scheduler: ReportDeliveryScheduler;

	beforeEach(() => {
		let claimed = false;
		scheduleModel = {
			findOne: jest.fn(() => ({
				sort: jest.fn().mockResolvedValue(claimed ? null : schedule),
			})),
			findOneAndUpdate: jest.fn(async () => {
				claimed = true;
				return schedule;
			}),
			updateOne: jest.fn().mockResolvedValue({}),
			deleteOne: jest.fn().mockResolvedValue({}),
		};
		userModel = {
			findById: jest.fn(() => ({
				select: () => ({ lean: async () => ({ email: 'a@b.c' }) }),
			})),
		};
		reportsService = {
			generate: jest
				.fn()
				.mockResolvedValue({ filename: 'r.pdf', content: Buffer.from('x') }),
		};
		emailService = {
			sendScheduledReportEmail: jest.fn().mockResolvedValue(undefined),
		};
		resolver = { resolve: jest.fn(), resolveWithCapabilities: jest.fn() };

		scheduler = new ReportDeliveryScheduler(
			scheduleModel,
			userModel,
			reportsService as any,
			emailService as any,
			resolver
		);
	});

	it('plano sem reports.export: não gera, não envia e registra o motivo', async () => {
		resolver.resolveWithCapabilities.mockResolvedValue({
			tier: FREE_ACCESS_LEVEL,
			capabilities: [],
		});

		await scheduler.deliverDueReports(now);

		expect(reportsService.generate).not.toHaveBeenCalled();
		expect(emailService.sendScheduledReportEmail).not.toHaveBeenCalled();
		expect(scheduleModel.updateOne).toHaveBeenCalledWith(
			{ _id: 's-1' },
			{ $set: { lastError: PLAN_REQUIRED_ERROR } }
		);
		// O agendamento fica: volta a sair se o usuário reativar o plano.
		expect(scheduleModel.deleteOne).not.toHaveBeenCalled();
	});

	it('plano Pro: gera e envia normalmente', async () => {
		resolver.resolveWithCapabilities.mockResolvedValue({
			tier: PRO_ACCESS_LEVEL,
			capabilities: [],
		});

		await scheduler.deliverDueReports(now);

		expect(resolver.resolveWithCapabilities).toHaveBeenCalledWith('u-1');
		expect(reportsService.generate).toHaveBeenCalled();
		expect(emailService.sendScheduledReportEmail).toHaveBeenCalledWith(
			'a@b.c',
			expect.objectContaining({ attachment: expect.anything() })
		);
	});

	it('admin revogou reports.export no plano: bloqueia mesmo sendo Pro', async () => {
		resolver.resolveWithCapabilities.mockResolvedValue({
			tier: PRO_ACCESS_LEVEL,
			capabilities: ['broker.sync'],
			capabilitiesKnown: ['broker.sync', 'reports.export'],
		});

		await scheduler.deliverDueReports(now);

		expect(emailService.sendScheduledReportEmail).not.toHaveBeenCalled();
	});
});
