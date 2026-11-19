import { ExecutionContext, HttpException } from '@nestjs/common';
import { AppVersionGuard } from './app-version.guard';

const contextWith = (headers: object) =>
	({
		switchToHttp: () => ({ getRequest: () => ({ headers }) }),
	}) as unknown as ExecutionContext;

describe('AppVersionGuard', () => {
	const guard = new AppVersionGuard('1.2.0');

	it('deixa passar a versão mínima ou mais nova', () => {
		expect(guard.canActivate(contextWith({ 'x-app-version': '1.2.0' }))).toBe(
			true
		);
	});

	it.each([[{ 'x-app-version': '1.1.9' }], [{}]])(
		'responde 426 com a versão mínima: %j',
		(headers) => {
			expect.assertions(2);
			try {
				guard.canActivate(contextWith(headers));
			} catch (error) {
				expect((error as HttpException).getStatus()).toBe(426);
				expect((error as HttpException).getResponse()).toMatchObject({
					minVersion: '1.2.0',
				});
			}
		}
	);
});
