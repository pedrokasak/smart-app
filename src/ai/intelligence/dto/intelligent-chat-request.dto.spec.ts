import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IntelligentChatRequestDto } from './intelligent-chat-request.dto';

describe('IntelligentChatRequestDto', () => {
	it('accepts a valid intelligent chat payload', async () => {
		const dto = plainToInstance(IntelligentChatRequestDto, {
			question: 'Esse ativo faz sentido para minha carteira? PETR4',
			investorProfile: 'conservador',
			copilotFlow: 'sell_asset',
			decisionFlow: {
				action: 'sell',
				ticker: 'PETR4',
				quantity: 10,
				sellPrice: 38.5,
			},
		});

		const errors = await validate(dto);
		expect(errors).toHaveLength(0);
	});

	it('rejects invalid enum values and missing question', async () => {
		const dto = plainToInstance(IntelligentChatRequestDto, {
			investorProfile: 'moderado',
			copilotFlow: 'unknown_flow',
			decisionFlow: {
				action: 'invalid_action',
			},
		});

		const errors = await validate(dto);
		const errorPaths = errors.map((error) => error.property);

		expect(errorPaths).toContain('question');
		expect(errorPaths).toContain('investorProfile');
		expect(errorPaths).toContain('copilotFlow');
		expect(errorPaths).toContain('decisionFlow');
	});
});
