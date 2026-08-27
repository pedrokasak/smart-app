import { IsIn, IsOptional } from 'class-validator';
import {
	RiskToleranceLevel,
	SophisticationLevel,
} from 'src/intelligence/application/investor-profile/investor-profile.types';

// `null` explicito reseta o override de volta ao valor inferido
// (InvestorProfileService.setOverride); `undefined`/campo ausente deixa o
// campo intocado.
export class InvestorProfileOverrideDto {
	@IsOptional()
	@IsIn(['beginner', 'intermediate', 'experienced', null])
	sophistication?: SophisticationLevel | null;

	@IsOptional()
	@IsIn(['conservative', 'moderate', 'aggressive', null])
	riskTolerance?: RiskToleranceLevel | null;
}
