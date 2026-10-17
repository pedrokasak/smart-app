import { BadRequestException } from '@nestjs/common';
import { PortfolioPolicyService } from './portfolio-policy.service';
import { suggestedPolicy } from '../domain/investment-policy';

function modelReturning(doc: unknown) {
	const query = {
		sort: jest.fn().mockReturnThis(),
		select: jest.fn().mockReturnThis(),
		lean: jest.fn().mockResolvedValue(doc),
	};
	return { findOne: jest.fn().mockReturnValue(query), query };
}

const primaryPolicy = {
	targets: [{ key: 'stocks', label: 'Ações', pct: 70 }],
	maxPositionPct: 12,
};

describe('PortfolioPolicyService (TRA-106)', () => {
	it('sem política explícita, usa a sugerida pela finalidade', async () => {
		const model = modelReturning(null);
		const service = new PortfolioPolicyService(model as any);

		await expect(
			service.resolveForCreate('u1', { purpose: 'income' })
		).resolves.toEqual({
			purpose: 'income',
			policy: suggestedPolicy('income'),
		});
		expect(model.findOne).not.toHaveBeenCalled();
	});

	it('sem finalidade (sincronização, fluxo antigo) nasce sem política', async () => {
		const service = new PortfolioPolicyService(modelReturning(null) as any);
		await expect(service.resolveForCreate('u1', {})).resolves.toEqual({
			purpose: null,
			policy: null,
		});
	});

	it('política explícita vence a sugestão e passa pelas regras', async () => {
		const service = new PortfolioPolicyService(modelReturning(null) as any);
		await expect(
			service.resolveForCreate('u1', {
				purpose: 'reserve',
				policy: primaryPolicy,
			})
		).resolves.toEqual({ purpose: 'reserve', policy: primaryPolicy });

		await expect(
			service.resolveForCreate('u1', {
				policy: {
					targets: [
						{ key: 'a', label: 'A', pct: 70 },
						{ key: 'b', label: 'B', pct: 40 },
					],
					maxPositionPct: 10,
				},
			})
		).rejects.toThrow(BadRequestException);
	});

	it('herda a política da carteira mais antiga que tem uma', async () => {
		const model = modelReturning({
			_id: 'p0',
			name: 'Principal',
			policy: primaryPolicy,
		});
		const service = new PortfolioPolicyService(model as any);

		await expect(
			service.resolveForCreate('u1', {
				purpose: 'income',
				inheritPrimaryPolicy: true,
			})
		).resolves.toEqual({ purpose: 'income', policy: primaryPolicy });
		expect(model.findOne).toHaveBeenCalledWith({
			userId: 'u1',
			policy: { $ne: null },
		});
		expect(model.query.sort).toHaveBeenCalledWith({ createdAt: 1 });
	});

	it('pediu para herdar mas não há carteira com política: cai na sugestão', async () => {
		const service = new PortfolioPolicyService(modelReturning(null) as any);
		await expect(
			service.resolveForCreate('u1', {
				purpose: 'speculative',
				inheritPrimaryPolicy: true,
			})
		).resolves.toEqual({
			purpose: 'speculative',
			policy: suggestedPolicy('speculative'),
		});
	});

	it('sugestões trazem as finalidades e a principal', async () => {
		const service = new PortfolioPolicyService(
			modelReturning({
				_id: 'p0',
				name: 'Principal',
				policy: primaryPolicy,
			}) as any
		);
		const result = await service.suggestions('u1');

		expect(result.purposes).toHaveLength(4);
		expect(result.primary).toEqual({
			portfolioId: 'p0',
			name: 'Principal',
			policy: primaryPolicy,
		});
	});

	it('política gravada fora das regras não é oferecida para cópia', async () => {
		const service = new PortfolioPolicyService(
			modelReturning({
				_id: 'p0',
				name: 'Velha',
				policy: { targets: [], maxPositionPct: 10 },
			}) as any
		);
		await expect(service.suggestions('u1')).resolves.toMatchObject({
			primary: null,
		});
	});
});
