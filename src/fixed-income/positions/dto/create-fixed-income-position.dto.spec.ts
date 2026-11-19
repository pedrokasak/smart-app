import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateFixedIncomePositionDto } from './create-fixed-income-position.dto';

const invalid = (body: object) =>
	validateSync(plainToInstance(CreateFixedIncomePositionDto, body)).map(
		(error) => error.property
	);

describe('CreateFixedIncomePositionDto (TRA-230)', () => {
	const base = {
		kind: 'LCA',
		indexer: 'PERCENT_CDI',
		ratePct: 95,
		principal: 5000,
		appliedAt: '2025-06-02',
	};

	it('aceita sem vencimento (liquidez diária) e com vencimento null', () => {
		expect(invalid(base)).toEqual([]);
		expect(invalid({ ...base, maturityDate: null })).toEqual([]);
		expect(invalid({ ...base, maturityDate: '2027-06-01' })).toEqual([]);
	});

	it('recusa tipo e indexador fora da lista, principal zero e data com hora', () => {
		expect(
			invalid({
				...base,
				kind: 'POUPANCA',
				indexer: 'IGPM',
				principal: 0,
				appliedAt: '2025-06-02T10:00:00Z',
				maturityDate: '2027-13-01',
			})
		).toEqual(['kind', 'indexer', 'principal', 'appliedAt', 'maturityDate']);
	});
});
