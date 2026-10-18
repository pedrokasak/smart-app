import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreatePortfolioDto } from './create-portfolio.dto';
import { UpdatePortfolioDto } from './update-portfolio.dto';

function errors(cls: any, body: object) {
	return validateSync(plainToInstance(cls, body), {
		whitelist: true,
		forbidNonWhitelisted: true,
	}).map((error) => error.property);
}

describe('CreatePortfolioDto — finalidade e política (TRA-106)', () => {
	const base = { name: 'Renda passiva', ownerType: 'self' };

	it('aceita finalidade, política e herança', () => {
		expect(
			errors(CreatePortfolioDto, {
				...base,
				purpose: 'income',
				inheritPrimaryPolicy: false,
				policy: {
					targets: [{ key: 'fiis', label: 'FIIs', pct: 40 }],
					maxPositionPct: 8,
				},
			})
		).toEqual([]);
	});

	it('recusa finalidade desconhecida e meta fora da faixa', () => {
		expect(errors(CreatePortfolioDto, { ...base, purpose: 'yolo' })).toEqual([
			'purpose',
		]);
		expect(
			errors(CreatePortfolioDto, {
				...base,
				policy: {
					targets: [{ key: 'FIIs!', label: 'FIIs', pct: 140 }],
					maxPositionPct: 0,
				},
			})
		).toEqual(['policy']);
	});

	it('a edição genérica não aceita política (fica para fluxo próprio)', () => {
		expect(
			errors(UpdatePortfolioDto, {
				purpose: 'income',
				policy: { targets: [], maxPositionPct: 8 },
			})
		).toEqual(['purpose', 'policy']);
	});
});
