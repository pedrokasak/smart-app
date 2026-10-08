import { ForbiddenException } from '@nestjs/common';
import { PlanQuotaService } from './plan-quota.service';

describe('PlanQuotaService (TRA-197)', () => {
	let access: { tier: number; capabilities: string[]; quotas?: any };
	let used: Record<string, number>;
	let service: PlanQuotaService;

	beforeEach(() => {
		access = { tier: 0, capabilities: [] };
		used = { assets: 0, portfolios: 0, broker_connections: 0 };
		service = new PlanQuotaService(
			{ resolveWithCapabilities: async () => access } as any,
			{ count: async (_u: string, resource: string) => used[resource] } as any
		);
	});

	async function quotaError(promise: Promise<unknown>) {
		const error: ForbiddenException = await promise.then(
			() => {
				throw new Error('não recusou');
			},
			(e) => e
		);
		expect(error).toBeInstanceOf(ForbiddenException);
		return error.getResponse() as Record<string, unknown>;
	}

	describe('assertCanAdd', () => {
		it('libera abaixo do limite', async () => {
			used.assets = 9;
			await expect(
				service.assertCanAdd('u1', 'assets')
			).resolves.toBeUndefined();
		});

		it('recusa quando adicionar passaria do limite, com recurso e limite', async () => {
			used.assets = 10;

			expect(
				await quotaError(service.assertCanAdd('u1', 'assets'))
			).toMatchObject({
				error: 'PLAN_QUOTA_EXCEEDED',
				resource: 'assets',
				limit: 10,
			});
		});

		it('conta o lote inteiro: 8 + 3 passa de 10', async () => {
			used.assets = 8;

			await expect(service.assertCanAdd('u1', 'assets', 2)).resolves.toBe(
				undefined
			);
			await quotaError(service.assertCanAdd('u1', 'assets', 3));
		});

		it('plano ilimitado nem consulta o uso', async () => {
			access = { tier: 10, capabilities: [] };
			const count = jest.fn();
			service = new PlanQuotaService(
				{ resolveWithCapabilities: async () => access } as any,
				{ count } as any
			);

			await service.assertCanAdd('u1', 'assets');

			expect(count).not.toHaveBeenCalled();
		});

		it('quem já passou do limite só é barrado ao criar mais', async () => {
			used.assets = 40;

			await quotaError(service.assertCanAdd('u1', 'assets'));
		});

		it('usa a cota gravada no plano, não o padrão do nível', async () => {
			access = { tier: 0, capabilities: [], quotas: { assets: 3 } };
			used.assets = 3;

			expect(
				await quotaError(service.assertCanAdd('u1', 'assets'))
			).toMatchObject({ limit: 3 });
		});
	});

	describe('createWithinQuota', () => {
		const create = () => jest.fn().mockResolvedValue({ _id: 'novo' });

		it('abaixo do limite cria e devolve', async () => {
			used.portfolios = 0;
			const doCreate = create();
			const undo = jest.fn();

			await expect(
				service.createWithinQuota('u1', 'portfolios', doCreate, undo)
			).resolves.toEqual({ _id: 'novo' });
			expect(undo).not.toHaveBeenCalled();
		});

		it('no limite recusa ANTES de criar (sem efeito colateral)', async () => {
			used.portfolios = 1;
			const doCreate = create();

			await quotaError(
				service.createWithinQuota('u1', 'portfolios', doCreate, jest.fn())
			);
			expect(doCreate).not.toHaveBeenCalled();
		});

		it('corrida: duas requisições passam na conferência, a segunda desfaz a própria', async () => {
			// Antes de gravar nenhuma das duas vê 0; depois de gravar, vê 2.
			const counts = [0, 2];
			service = new PlanQuotaService(
				{ resolveWithCapabilities: async () => access } as any,
				{ count: async () => counts.shift() } as any
			);
			const undo = jest.fn().mockResolvedValue(undefined);

			await quotaError(
				service.createWithinQuota('u1', 'portfolios', create(), undo)
			);

			expect(undo).toHaveBeenCalledWith({ _id: 'novo' });
		});

		it('plano ilimitado só cria', async () => {
			access = { tier: 10, capabilities: [] };
			const doCreate = create();

			await service.createWithinQuota('u1', 'assets', doCreate, jest.fn());

			expect(doCreate).toHaveBeenCalledTimes(1);
		});
	});

	describe('consulta do plano falhou (degraded)', () => {
		beforeEach(() => {
			access = { tier: 0, capabilities: [], degraded: true } as any;
			used.assets = 40;
		});

		it('não barra: falha de leitura não faz pagante virar gratuito', async () => {
			await expect(
				service.assertCanAdd('u1', 'assets')
			).resolves.toBeUndefined();
			expect(await service.limitFor('u1', 'assets')).toBeNull();
		});

		it('createWithinQuota só cria', async () => {
			const doCreate = jest.fn().mockResolvedValue({ _id: 'novo' });

			await service.createWithinQuota('u1', 'assets', doCreate, jest.fn());

			expect(doCreate).toHaveBeenCalledTimes(1);
		});
	});

	it('usageFor devolve uso e limite de cada recurso', async () => {
		used = { assets: 7, portfolios: 1, broker_connections: 0 };

		expect(await service.usageFor('u1')).toEqual([
			{ resource: 'assets', used: 7, limit: 10 },
			{ resource: 'portfolios', used: 1, limit: 1 },
			{ resource: 'broker_connections', used: 0, limit: 1 },
		]);
	});

	it('usageFor mostra limite null para plano ilimitado', async () => {
		access = { tier: 10, capabilities: [] };

		const usage = await service.usageFor('u1');

		expect(usage.find((u) => u.resource === 'assets')?.limit).toBeNull();
	});
});
