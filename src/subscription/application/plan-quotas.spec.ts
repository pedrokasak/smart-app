import {
	defaultPlanQuota,
	effectivePlanQuotas,
	normalizePlanQuotas,
	planQuotaExceeded,
	planQuotaLimit,
} from './plan-quotas';
import {
	FREE_ACCESS_LEVEL,
	PREMIUM_ACCESS_LEVEL,
	PRO_ACCESS_LEVEL,
} from './user-plan.types';

describe('plan-quotas (TRA-197)', () => {
	describe('padrão por nível (o que os cards prometem)', () => {
		it('Essencial: 10 ativos, 1 carteira, 1 corretora', () => {
			expect(defaultPlanQuota('assets', FREE_ACCESS_LEVEL)).toBe(10);
			expect(defaultPlanQuota('portfolios', FREE_ACCESS_LEVEL)).toBe(1);
			expect(defaultPlanQuota('broker_connections', FREE_ACCESS_LEVEL)).toBe(1);
		});

		it('Pro: ativos e carteiras ilimitados, 5 contas', () => {
			expect(defaultPlanQuota('assets', PRO_ACCESS_LEVEL)).toBeNull();
			expect(defaultPlanQuota('portfolios', PRO_ACCESS_LEVEL)).toBeNull();
			expect(defaultPlanQuota('broker_connections', PRO_ACCESS_LEVEL)).toBe(5);
		});

		it('Wealth: ilimitado em ativos e carteiras, 20 contas', () => {
			expect(defaultPlanQuota('assets', PREMIUM_ACCESS_LEVEL)).toBeNull();
			expect(defaultPlanQuota('portfolios', PREMIUM_ACCESS_LEVEL)).toBeNull();
			expect(defaultPlanQuota('broker_connections', PREMIUM_ACCESS_LEVEL)).toBe(
				20
			);
		});

		it('nível intermediário criado no admin cai no patamar de baixo', () => {
			expect(defaultPlanQuota('broker_connections', 15)).toBe(5);
			expect(defaultPlanQuota('assets', 5)).toBe(10);
		});
	});

	describe('planQuotaLimit', () => {
		it('plano nunca configurado usa o padrão do nível', () => {
			expect(planQuotaLimit(undefined, 'assets', FREE_ACCESS_LEVEL)).toBe(10);
			expect(planQuotaLimit({}, 'assets', FREE_ACCESS_LEVEL)).toBe(10);
		});

		it('o que o admin gravou manda sobre o padrão', () => {
			expect(planQuotaLimit({ assets: 50 }, 'assets', FREE_ACCESS_LEVEL)).toBe(
				50
			);
		});

		it('null gravado é "ilimitado", não "não decidido"', () => {
			expect(
				planQuotaLimit({ assets: null }, 'assets', FREE_ACCESS_LEVEL)
			).toBeNull();
		});

		it('zero é um limite válido (bloqueia criar)', () => {
			expect(
				planQuotaLimit({ portfolios: 0 }, 'portfolios', PRO_ACCESS_LEVEL)
			).toBe(0);
		});

		it('recurso que o plano não decidiu cai no padrão, mesmo com outros gravados', () => {
			expect(
				planQuotaLimit({ assets: 50 }, 'portfolios', FREE_ACCESS_LEVEL)
			).toBe(1);
		});

		it('valor inválido é ignorado em vez de virar limite', () => {
			expect(
				planQuotaLimit({ assets: -3 } as any, 'assets', FREE_ACCESS_LEVEL)
			).toBe(10);
		});
	});

	it('effectivePlanQuotas resolve todos os recursos de uma vez', () => {
		expect(effectivePlanQuotas({ assets: 25 }, FREE_ACCESS_LEVEL)).toEqual({
			assets: 25,
			portfolios: 1,
			broker_connections: 1,
		});
	});

	describe('normalizePlanQuotas', () => {
		it('mantém números e null, descarta o resto', () => {
			expect(
				normalizePlanQuotas({
					assets: 5,
					portfolios: null,
					broker_connections: 'muitas',
					outra: 1,
				})
			).toEqual({ assets: 5, portfolios: null });
		});

		it('sem nada válido devolve undefined', () => {
			expect(normalizePlanQuotas(undefined)).toBeUndefined();
			expect(normalizePlanQuotas({ assets: -1 })).toBeUndefined();
			expect(normalizePlanQuotas('x')).toBeUndefined();
		});
	});

	it('o erro carrega código estável, recurso e limite', () => {
		const error = planQuotaExceeded('assets', 10);

		expect(error.getStatus()).toBe(403);
		expect(error.getResponse()).toMatchObject({
			statusCode: 403,
			error: 'PLAN_QUOTA_EXCEEDED',
			resource: 'assets',
			limit: 10,
			message: expect.stringContaining('10 ativos'),
		});
	});

	it('a mensagem de carteiras mantém "Limite de portfólios", que o web reconhece', () => {
		const response = planQuotaExceeded('portfolios', 1).getResponse() as {
			message: string;
		};

		expect(response.message).toContain('Limite de portfólios');
	});
});
