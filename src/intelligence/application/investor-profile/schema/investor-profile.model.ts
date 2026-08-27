import { Schema, Document, model, Types } from 'mongoose';
import {
	InvestorProfileSource,
	RiskToleranceLevel,
	SophisticationLevel,
} from 'src/intelligence/application/investor-profile/investor-profile.types';

export interface InvestorProfileDocument extends Document {
	userId: Types.ObjectId;
	sophistication: SophisticationLevel;
	riskTolerance: RiskToleranceLevel;
	confidence: number;
	signals: Record<string, number | boolean>;
	source: InvestorProfileSource;
	overriddenSophistication: SophisticationLevel | null;
	overriddenRiskTolerance: RiskToleranceLevel | null;
	createdAt: Date;
	updatedAt: Date;
}

export const investorProfileSchema = new Schema<InvestorProfileDocument>(
	{
		userId: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: true,
			unique: true,
			index: true,
		},
		sophistication: {
			type: String,
			enum: ['beginner', 'intermediate', 'experienced'],
			required: true,
		},
		riskTolerance: {
			type: String,
			enum: ['conservative', 'moderate', 'aggressive'],
			required: true,
		},
		confidence: {
			type: Number,
			required: true,
			min: 0.1,
			max: 1,
		},
		signals: {
			type: Schema.Types.Mixed,
			default: {},
		},
		source: {
			type: String,
			enum: ['inferred', 'user_override'],
			default: 'inferred',
		},
		overriddenSophistication: {
			type: String,
			enum: ['beginner', 'intermediate', 'experienced', null],
			default: null,
		},
		overriddenRiskTolerance: {
			type: String,
			enum: ['conservative', 'moderate', 'aggressive', null],
			default: null,
		},
	},
	{
		timestamps: true,
		collection: 'investor_profile',
	}
);

export const InvestorProfileModel = model<InvestorProfileDocument>(
	'InvestorProfile',
	investorProfileSchema
);
