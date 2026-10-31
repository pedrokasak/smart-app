import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role } from 'src/auth/enums/role.enum';
import { ROLE_CHANGE_BOOTSTRAP_ACTOR } from '../schema/role-change-audit.model';
import { AdminRoleService } from './admin-role.service';
import { SECURITY_EVENT } from 'src/audit/domain/security-events';

const BOOTSTRAP_EMAIL = 'dono@exemplo.com';

function makeUser(overrides: Record<string, unknown> = {}) {
	return {
		_id: 'user-id',
		email: 'alvo@exemplo.com',
		role: Role.User,
		isEmailVerified: true,
		save: jest.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

describe('AdminRoleService (TRA-184)', () => {
	let userModel: { findOne: jest.Mock; findById: jest.Mock };
	let auditModel: { create: jest.Mock };
	let service: AdminRoleService;
	let securityAudit: { emit: jest.Mock };
	const originalEnv = process.env.ADMIN_BOOTSTRAP_EMAIL;

	beforeEach(() => {
		process.env.ADMIN_BOOTSTRAP_EMAIL = BOOTSTRAP_EMAIL;
		userModel = { findOne: jest.fn(), findById: jest.fn() };
		auditModel = { create: jest.fn().mockResolvedValue({}) };
		securityAudit = { emit: jest.fn() };
		service = new AdminRoleService(
			userModel as any,
			auditModel as any,
			securityAudit
		);
	});

	afterAll(() => {
		if (originalEnv === undefined) delete process.env.ADMIN_BOOTSTRAP_EMAIL;
		else process.env.ADMIN_BOOTSTRAP_EMAIL = originalEnv;
	});

	describe('updateUserRoleByEmail', () => {
		it('altera a role e grava quem fez, de qual role para qual', async () => {
			const target = makeUser();
			const actor = makeUser({
				_id: 'admin-id',
				email: 'admin@exemplo.com',
				role: Role.Admin,
			});
			userModel.findOne.mockResolvedValue(target);
			userModel.findById.mockResolvedValue(actor);

			const result = await service.updateUserRoleByEmail(
				'admin-id',
				' Alvo@Exemplo.com ',
				Role.Editor
			);

			expect(userModel.findOne).toHaveBeenCalledWith({
				email: 'alvo@exemplo.com',
			});
			expect(target.role).toBe(Role.Editor);
			expect(target.save).toHaveBeenCalled();
			expect(auditModel.create).toHaveBeenCalledWith({
				user: 'user-id',
				userEmail: 'alvo@exemplo.com',
				previousRole: Role.User,
				newRole: Role.Editor,
				performedBy: 'admin-id',
				performedByEmail: 'admin@exemplo.com',
			});
			expect(result.user).toEqual({
				id: 'user-id',
				email: 'alvo@exemplo.com',
				role: Role.Editor,
			});
		});

		it('registra na trilha quem mudou o papel de quem, sem e-mail', async () => {
			userModel.findOne.mockResolvedValue(makeUser());
			userModel.findById.mockResolvedValue(
				makeUser({ _id: 'admin-id', email: 'admin@exemplo.com' })
			);

			await service.updateUserRoleByEmail(
				'admin-id',
				'alvo@exemplo.com',
				Role.Editor
			);

			const event = securityAudit.emit.mock.calls[0][0];
			expect(event).toEqual({
				type: SECURITY_EVENT.RoleChanged,
				actor: { userId: 'admin-id' },
				subject: { userId: 'user-id' },
				payload: { from: Role.User, to: Role.Editor, via: 'admin_panel' },
			});
			expect(JSON.stringify(event)).not.toContain('@');
		});

		it('não registra quando a role não é aceita', async () => {
			await expect(
				service.updateUserRoleByEmail('admin-id', 'a@b.com', Role.Advisor)
			).rejects.toBeInstanceOf(BadRequestException);
			expect(securityAudit.emit).not.toHaveBeenCalled();
		});

		it('recusa roles fora de admin/editor sem tocar no banco', async () => {
			await expect(
				service.updateUserRoleByEmail('admin-id', 'a@b.com', Role.Advisor)
			).rejects.toBeInstanceOf(BadRequestException);
			expect(userModel.findOne).not.toHaveBeenCalled();
			expect(auditModel.create).not.toHaveBeenCalled();
		});

		it('não altera nada quando o alvo não existe', async () => {
			userModel.findOne.mockResolvedValue(null);
			userModel.findById.mockResolvedValue(makeUser());

			await expect(
				service.updateUserRoleByEmail('admin-id', 'a@b.com', Role.Admin)
			).rejects.toBeInstanceOf(NotFoundException);
			expect(auditModel.create).not.toHaveBeenCalled();
		});

		it('não altera nada quando o executor não existe', async () => {
			const target = makeUser();
			userModel.findOne.mockResolvedValue(target);
			userModel.findById.mockResolvedValue(null);

			await expect(
				service.updateUserRoleByEmail('admin-id', 'a@b.com', Role.Admin)
			).rejects.toBeInstanceOf(NotFoundException);
			expect(target.save).not.toHaveBeenCalled();
			expect(auditModel.create).not.toHaveBeenCalled();
		});
	});

	describe('ensureBootstrapAdmin', () => {
		it('promove o dono verificado e audita como bootstrap', async () => {
			const owner = makeUser({ email: BOOTSTRAP_EMAIL });
			userModel.findOne.mockResolvedValue(owner);

			await service.ensureBootstrapAdmin();

			expect(userModel.findOne).toHaveBeenCalledWith({
				email: BOOTSTRAP_EMAIL,
			});
			expect(owner.role).toBe(Role.Admin);
			expect(auditModel.create).toHaveBeenCalledWith(
				expect.objectContaining({
					previousRole: Role.User,
					newRole: Role.Admin,
					performedByEmail: ROLE_CHANGE_BOOTSTRAP_ACTOR,
				})
			);
		});

		it('não promove conta com e-mail não verificado', async () => {
			const squatter = makeUser({
				email: BOOTSTRAP_EMAIL,
				isEmailVerified: false,
			});
			userModel.findOne.mockResolvedValue(squatter);

			await service.ensureBootstrapAdmin();

			expect(squatter.role).toBe(Role.User);
			expect(squatter.save).not.toHaveBeenCalled();
			expect(auditModel.create).not.toHaveBeenCalled();
		});

		it('não faz nada quando o dono já é admin ou ainda não existe', async () => {
			userModel.findOne.mockResolvedValueOnce(
				makeUser({ email: BOOTSTRAP_EMAIL, role: Role.Admin })
			);
			await service.ensureBootstrapAdmin();
			userModel.findOne.mockResolvedValueOnce(null);
			await service.ensureBootstrapAdmin();

			expect(auditModel.create).not.toHaveBeenCalled();
		});
	});
});
