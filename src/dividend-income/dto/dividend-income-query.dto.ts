import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsMongoId, IsOptional } from 'class-validator';
import {
	DIDACTIC_LEVELS,
	type DidacticLevel,
} from 'src/ai/didactic/didactic.types';

export class DividendIncomeQueryDto {
	@ApiPropertyOptional({
		description: 'Só esta carteira (do próprio usuário); ausente = todas.',
	})
	@IsOptional()
	@IsMongoId()
	portfolioId?: string;

	@ApiPropertyOptional({
		enum: DIDACTIC_LEVELS,
		description:
			'Nível da explicação (só muda a redação); ausente = intermediário.',
	})
	@IsOptional()
	@IsIn(DIDACTIC_LEVELS)
	level?: DidacticLevel;
}
