import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Role } from 'src/auth/enums/role.enum';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { AuditVerifyService } from 'src/audit/application/audit-verify.service';
import {
	AuditAdminController,
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
		const controller = new AuditAdminController({
			verify,
		} as unknown as AuditVerifyService);
		await controller.verify({ fromSeq: 3, toSeq: 9 });
		expect(verify).toHaveBeenCalledWith({ fromSeq: 3, toSeq: 9 });
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
