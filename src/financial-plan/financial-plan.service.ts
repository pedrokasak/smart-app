import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FinancialPlan, GoalKind } from './infrastructure/financial-plan.model';

export const MAX_GOALS = 6;

export interface GoalView {
	id: string;
	title: string;
	kind: GoalKind;
	targetAmount: number;
	currentAmount: number;
	monthlyContribution: number;
}

export interface FinancialPlanView {
	monthlyContribution: number;
	expectedRealReturnPct: number;
	horizonYears: number;
	goals: GoalView[];
}

const DEFAULT_PLAN: Omit<FinancialPlanView, 'goals'> = {
	monthlyContribution: 0,
	expectedRealReturnPct: 6,
	horizonYears: 20,
};

type GoalInput = Omit<GoalView, 'id'>;

const toView = (plan: FinancialPlan | null): FinancialPlanView =>
	plan
		? {
				monthlyContribution: plan.monthlyContribution,
				expectedRealReturnPct: plan.expectedRealReturnPct,
				horizonYears: plan.horizonYears,
				goals: plan.goals.map((goal) => ({
					id: String(goal._id),
					title: goal.title,
					kind: goal.kind,
					targetAmount: goal.targetAmount,
					currentAmount: goal.currentAmount,
					monthlyContribution: goal.monthlyContribution,
				})),
			}
		: { ...DEFAULT_PLAN, goals: [] };

/** Plano financeiro (aporte, retorno esperado, horizonte) e metas do usuário (TRA-177). */
@Injectable()
export class FinancialPlanService {
	constructor(
		@InjectModel('FinancialPlan')
		private readonly planModel: Model<FinancialPlan>
	) {}

	async get(userId: string): Promise<FinancialPlanView> {
		return toView(
			await this.planModel.findOne({ userId: new Types.ObjectId(userId) })
		);
	}

	async updateSettings(
		userId: string,
		settings: Omit<FinancialPlanView, 'goals'>
	): Promise<FinancialPlanView> {
		const plan = await this.planModel.findOneAndUpdate(
			{ userId: new Types.ObjectId(userId) },
			{ $set: settings },
			{ new: true, upsert: true, setDefaultsOnInsert: true }
		);
		return toView(plan);
	}

	async addGoal(userId: string, input: GoalInput): Promise<FinancialPlanView> {
		const objectUserId = new Types.ObjectId(userId);
		const goal =
			input.kind === 'independence' ? { ...input, currentAmount: 0 } : input;

		const plan =
			(await this.planModel.findOne({ userId: objectUserId })) ??
			new this.planModel({ userId: objectUserId, goals: [] });
		if (plan.goals.length >= MAX_GOALS) {
			throw new BadRequestException(`Limite de ${MAX_GOALS} metas atingido.`);
		}
		plan.goals.push(goal);
		this.assertSingleIndependence(plan);
		await plan.save();
		return toView(plan);
	}

	async updateGoal(
		userId: string,
		goalId: string,
		patch: Partial<GoalInput>
	): Promise<FinancialPlanView> {
		const plan = await this.findPlanWithGoal(userId, goalId);
		const goal = plan.goals.id(goalId)!;
		Object.assign(goal, patch);
		if (goal.kind === 'independence') goal.currentAmount = 0;
		this.assertSingleIndependence(plan);
		await plan.save();
		return toView(plan);
	}

	async removeGoal(userId: string, goalId: string): Promise<FinancialPlanView> {
		const plan = await this.findPlanWithGoal(userId, goalId);
		plan.goals.id(goalId)!.deleteOne();
		await plan.save();
		return toView(plan);
	}

	private async findPlanWithGoal(
		userId: string,
		goalId: string
	): Promise<FinancialPlan> {
		const plan = Types.ObjectId.isValid(goalId)
			? await this.planModel.findOne({
					userId: new Types.ObjectId(userId),
					'goals._id': new Types.ObjectId(goalId),
				})
			: null;
		if (!plan) throw new NotFoundException('Meta não encontrada.');
		return plan;
	}

	/** Só existe uma independência financeira: é ela que a projeção acompanha. */
	private assertSingleIndependence(plan: FinancialPlan) {
		if (plan.goals.filter((goal) => goal.kind === 'independence').length > 1) {
			throw new BadRequestException(
				'Você já tem uma meta de independência financeira.'
			);
		}
	}
}
