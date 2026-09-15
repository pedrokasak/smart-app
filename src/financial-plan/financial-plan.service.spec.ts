import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FinancialPlanService, MAX_GOALS } from './financial-plan.service';

const userId = new Types.ObjectId().toString();

function planDoc(goals: any[] = []) {
	const list: any = goals.map((goal) => ({
		_id: new Types.ObjectId(),
		...goal,
	}));
	list.id = (id: string) => {
		const found = list.find((goal: any) => String(goal._id) === id);
		if (found) found.deleteOne = () => list.splice(list.indexOf(found), 1);
		return found;
	};
	return {
		monthlyContribution: 1000,
		expectedRealReturnPct: 6,
		horizonYears: 20,
		goals: list,
		save: jest.fn(),
	};
}

describe('FinancialPlanService', () => {
	const model: any = jest.fn((doc) => ({
		...planDoc(),
		...doc,
		goals: planDoc().goals,
	}));
	model.findOne = jest.fn();
	model.findOneAndUpdate = jest.fn();
	const service = new FinancialPlanService(model);

	const goal = {
		title: 'Reserva',
		kind: 'emergency',
		targetAmount: 90000,
		currentAmount: 86000,
		monthlyContribution: 500,
	} as const;

	beforeEach(() => {
		model.findOne.mockReset();
		model.findOneAndUpdate.mockReset();
	});

	it('returns defaults when the user has no plan yet', async () => {
		model.findOne.mockResolvedValue(null);

		await expect(service.get(userId)).resolves.toEqual({
			monthlyContribution: 0,
			expectedRealReturnPct: 6,
			horizonYears: 20,
			goals: [],
		});
	});

	it('adds a goal, zeroing the manual amount of the independence goal', async () => {
		const plan = planDoc();
		model.findOne.mockResolvedValue(plan);

		const view = await service.addGoal(userId, {
			...goal,
			kind: 'independence',
			title: 'IF',
			currentAmount: 5,
		});

		expect(view.goals[0]).toMatchObject({
			kind: 'independence',
			currentAmount: 0,
		});
		expect(plan.save).toHaveBeenCalled();
	});

	it('refuses a second independence goal and caps the number of goals', async () => {
		model.findOne.mockResolvedValue(
			planDoc([{ ...goal, kind: 'independence' }])
		);
		await expect(
			service.addGoal(userId, { ...goal, kind: 'independence' })
		).rejects.toThrow(BadRequestException);

		model.findOne.mockResolvedValue(
			planDoc(Array.from({ length: MAX_GOALS }, () => goal))
		);
		await expect(service.addGoal(userId, goal)).rejects.toThrow(
			BadRequestException
		);
	});

	it('only edits goals inside the user plan', async () => {
		model.findOne.mockResolvedValue(null);

		await expect(
			service.updateGoal(userId, new Types.ObjectId().toString(), {
				targetAmount: 1,
			})
		).rejects.toThrow(NotFoundException);
		await expect(service.removeGoal(userId, 'bad-id')).rejects.toThrow(
			NotFoundException
		);
		expect(String(model.findOne.mock.calls[0][0].userId)).toBe(userId);
	});

	it('updates and removes an existing goal', async () => {
		const plan = planDoc([goal]);
		const id = String(plan.goals[0]._id);
		model.findOne.mockResolvedValue(plan);

		expect(
			(await service.updateGoal(userId, id, { currentAmount: 90000 })).goals[0]
				.currentAmount
		).toBe(90000);
		expect((await service.removeGoal(userId, id)).goals).toEqual([]);
	});
});
