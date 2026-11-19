import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Role } from 'src/auth/enums/role.enum';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { AuditListService } from 'src/audit/application/audit-list.service';
import { AuditVerifyService } from 'src/audit/application/audit-verify.service';
import {
	AuditAdminController,
	ListAuditEventsQueryDto,
	VerifyAuditQueryDto,
} from './audit-admin.controller';

const contextFor = (role: Role): ExecutionContext =>
	({
		getHandler: () => AuditAdminController.prototype.verify,
		getClass: () => AuditAdminController,
		switchToHttp: () => ({
			getRequest: () => ({ user: { userId: 'u1', role } }),
		}),
	}) as unknown as ExecutionContext;

describe('AuditAdminController', () => {
	const guard = new RolesGuard(new Reflector());

	it('só admin verifica a trilha', () => {
		expect(guard.canActivate(contextFor(Role.Admin))).toBe(true);
		expect(() => guard.canActivate(contextFor(Role.Editor))).toThrow();
		expect(() => guard.canActivate(contextFor(Role.User))).toThrow();
	});

	it('repassa o trecho pedido para a verificação', async () => {
		const verify = jest.fn().mockResolvedValue({ ok: true });
		const controller = new AuditAdminController(
			{ verify } as unknown as AuditVerifyService,
			{} as AuditListService
		);
		await controller.verify({ fromSeq: 3, toSeq: 9 });
		expect(verify).toHaveBeenCalledWith({ fromSeq: 3, toSeq: 9 });
	});

	it('só admin lista os eventos', () => {
		const context = (role: Role) =>
			({
				getHandler: () => AuditAdminController.prototype.events,
				getClass: () => AuditAdminController,
				switchToHttp: () => ({
					getRequest: () => ({ user: { userId: 'u1', role } }),
				}),
			}) as unknown as ExecutionContext;
		expect(guard.canActivate(context(Role.Admin))).toBe(true);
		expect(() => guard.canActivate(context(Role.Editor))).toThrow();
	});

	it('repassa filtros e cursor para a listagem', async () => {
		const list = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
		const controller = new AuditAdminController(
			{} as AuditVerifyService,
			{ list } as unknown as AuditListService
		);
		await controller.events({ type: 'security.login.failed', limit: 20 });
		expect(list).toHaveBeenCalledWith({
			type: 'security.login.failed',
			limit: 20,
		});
	});

	it('limita a página a 100 e recusa limite zero', async () => {
		const bad = (limit: string) =>
			validate(plainToInstance(ListAuditEventsQueryDto, { limit }));
		expect(await bad('100')).toEqual([]);
		expect((await bad('101')).length).toBeGreaterThan(0);
		expect((await bad('0')).length).toBeGreaterThan(0);
	});

	it('aceita número como texto da query e recusa zero ou negativo', async () => {
		const parsed = plainToInstance(VerifyAuditQueryDto, {
			fromSeq: '5',
			toSeq: '10',
		});
		expect(await validate(parsed)).toEqual([]);
		expect(parsed.fromSeq).toBe(5);
		expect(
			(await validate(plainToInstance(VerifyAuditQueryDto, { fromSeq: '0' })))
				.length
		).toBeGreaterThan(0);
	});
});
