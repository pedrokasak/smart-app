import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Role } from 'src/auth/enums/role.enum';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { AgentControlService } from 'src/agent-control/application/agent-control.service';
import { AgentControlAdminController } from './agent-control-admin.controller';
import { UpdateAgentControlDto } from './dto/agent-control.dto';

type Handler = keyof AgentControlAdminController;

function contextFor(handler: Handler, role: Role): ExecutionContext {
	return {
		getHandler: () => AgentControlAdminController.prototype[handler],
		getClass: () => AgentControlAdminController,
		switchToHttp: () => ({
			getRequest: () => ({ user: { userId: 'u1', role } }),
		}),
	} as unknown as ExecutionContext;
}

describe('AgentControlAdminController (ADR-005)', () => {
	const guard = new RolesGuard(new Reflector());

	it.each([Role.Admin, Role.Editor])('%p pode ler a lista', (role) => {
		expect(guard.canActivate(contextFor('list', role))).toBe(true);
		expect(guard.canActivate(contextFor('get', role))).toBe(true);
	});

	it.each([
		'update',
		'pauseAllAi',
		'listChanges',
		'listAllChanges',
	] as Handler[])('só admin chega em %p', (handler) => {
		expect(guard.canActivate(contextFor(handler, Role.Admin))).toBe(true);
		expect(() => guard.canActivate(contextFor(handler, Role.Editor))).toThrow();
		expect(() => guard.canActivate(contextFor(handler, Role.User))).toThrow();
	});

	it('usuário comum não lê nada', () => {
		expect(() => guard.canActivate(contextFor('list', Role.User))).toThrow();
	});

	it('passa o admin pseudonimizado e o IP para o serviço', async () => {
		const change = jest.fn().mockResolvedValue({ id: 'ri-watch' });
		const controller = new AgentControlAdminController({
			change,
		} as unknown as AgentControlService);

		await controller.update(
			{ user: { userId: 'u1' }, ip: '10.0.0.9' },
			'ri-watch',
			{ enabled: false, reason: 'motivo de teste', version: 3, totp: '123456' }
		);

		expect(change).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 'u1',
				ip: '10.0.0.9',
				ref: expect.stringMatching(/^usr_[0-9a-f]{32}$/),
			}),
			'ri-watch',
			{ enabled: false, reason: 'motivo de teste', version: 3, totp: '123456' }
		);
	});

	describe('UpdateAgentControlDto', () => {
		const errorsOf = async (body: Record<string, unknown>) =>
			(await validate(plainToInstance(UpdateAgentControlDto, body))).map(
				(error) => error.property
			);

		it('exige versão e código 2FA de 6 dígitos', async () => {
			expect(await errorsOf({ enabled: false })).toEqual(
				expect.arrayContaining(['version', 'totp'])
			);
			expect(await errorsOf({ version: 1, totp: '12345' })).toContain('totp');
		});

		it('só aceita a pausa aprovada', async () => {
			expect(
				await errorsOf({ version: 1, totp: '123456', pause: 'forever' })
			).toContain('pause');
		});

		it('aceita uma mudança válida', async () => {
			expect(
				await errorsOf({
					version: 1,
					totp: '123456',
					config: { notify: true },
					reason: 'motivo de teste',
				})
			).toEqual([]);
		});
	});
});
