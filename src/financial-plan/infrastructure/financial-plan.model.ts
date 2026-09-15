import { Document, Schema, Types } from 'mongoose';

export const GOAL_KINDS = ['independence', 'emergency', 'custom'] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];

export interface FinancialGoal {
	_id: Types.ObjectId;
	title: string;
	kind: GoalKind;
	targetAmount: number;
	/** Valor já guardado. Ignorado na meta de independência: lá vale o patrimônio. */
	currentAmount: number;
	/** Aporte dedicado por mês; na independência vale o aporte do plano. */
	monthlyContribution: number;
}

export interface FinancialPlan extends Document {
	userId: Types.ObjectId;
	monthlyContribution: number;
	expectedRealReturnPct: number;
	horizonYears: number;
	goals: Types.DocumentArray<FinancialGoal & Types.Subdocument>;
}

const money = { type: Number, required: true, min: 0, max: 1e11 };

const goalSchema = new Schema<FinancialGoal>({
	title: { type: String, required: true, trim: true, maxlength: 60 },
	kind: { type: String, enum: GOAL_KINDS, required: true },
	targetAmount: money,
	currentAmount: { ...money, default: 0 },
	monthlyContribution: { ...money, default: 0 },
});

export const financialPlanSchema = new Schema<FinancialPlan>(
	{
		userId: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: true,
			unique: true,
		},
		monthlyContribution: { ...money, default: 0 },
		expectedRealReturnPct: {
			type: Number,
			required: true,
			min: -20,
			max: 30,
			default: 6,
		},
		horizonYears: {
			type: Number,
			required: true,
			min: 1,
			max: 50,
			default: 20,
		},
		goals: { type: [goalSchema], default: [] },
	},
	{ timestamps: true }
);
