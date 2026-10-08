import { ValidationPipe } from '@nestjs/common';
import { InvestmentFundsService } from './application/investment-funds.service';
import { InvestmentFundsController } from './investment-funds.controller';
import { InvestmentFundSearchQueryDto } from './investment-funds.dto';

describe('InvestmentFundsController', () => {
	const funds = {
		search: jest.fn(async () => [{ cnpj: '00017024000153' }]),
		getFund: jest.fn(async () => ({ cnpj: '00017024000153' })),
	};
	const controller = new InvestmentFundsController(
		funds as unknown as InvestmentFundsService
	);

	it('wraps search results', async () => {
		await expect(controller.search({ q: 'exemplo' })).resolves.toEqual({
			funds: [{ cnpj: '00017024000153' }],
		});
		expect(funds.search).toHaveBeenCalledWith('exemplo');
	});

	it('delegates the CNPJ lookup', async () => {
		await controller.getFund('00.017.024/0001-53');

		expect(funds.getFund).toHaveBeenCalledWith('00.017.024/0001-53');
	});

	describe('search query validation', () => {
		const pipe = new ValidationPipe({ whitelist: true, transform: true });
		const validate = (q: unknown) =>
			pipe.transform(
				{ q },
				{ type: 'query', metatype: InvestmentFundSearchQueryDto }
			);

		it('accepts a name or a masked CNPJ', async () => {
			await expect(validate('itau multimercado')).resolves.toBeDefined();
			await expect(validate('00.017.024/0001-53')).resolves.toBeDefined();
		});

		it('rejects too short, too long and missing queries', async () => {
			await expect(validate('a')).rejects.toThrow();
			await expect(validate('x'.repeat(81))).rejects.toThrow();
			await expect(validate(undefined)).rejects.toThrow();
		});
	});
});
