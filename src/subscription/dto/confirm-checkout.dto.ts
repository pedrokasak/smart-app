import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';

export class ConfirmCheckoutDto {
	@ApiProperty({
		description:
			'ID da sessão de checkout do Stripe (`session_id` do redirect).',
		example: 'cs_live_a1b2c3',
	})
	@IsString()
	@MaxLength(255)
	@Matches(/^cs_(live|test)_[A-Za-z0-9]+$/, {
		message: 'sessionId inválido.',
	})
	sessionId: string;
}
