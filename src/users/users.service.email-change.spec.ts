import { ConflictException } from '@nestjs/common';
import { UsersService } from './users.service';
import { UserModel } from './schema/user.model';
import { maskEmail } from 'src/notifications/email/email.service';

describe('UsersService.update — troca de e-mail (TRA-219)', () => {
	const emailService = {
		sendEmailChangedNotice: jest.fn().mockResolvedValue(undefined),
	};
	const service = new UsersService(
		{} as any,
		emailService as any,
		{} as any,
		{} as any,
		{} as any
	);
	const current = { _id: 'u1', email: 'dono@exemplo.com', firstName: 'Ana' };

	beforeEach(() => {
		jest.restoreAllMocks();
		emailService.sendEmailChangedNotice.mockClear();
		jest.spyOn(UserModel, 'findById').mockResolvedValue(current as any);
		jest.spyOn(UserModel, 'findByIdAndUpdate').mockImplementation((async (
			_id: unknown,
			update: any
		) => ({
			...current,
			...update,
		})) as any);
		jest.spyOn(UserModel, 'exists').mockResolvedValue(null as any);
	});

	it('avisa o e-mail antigo e grava o novo normalizado', async () => {
		const updated: any = await service.update('u1', {
			email: ' Novo@Exemplo.com ',
		} as any);

		expect(updated.email).toBe('novo@exemplo.com');
		expect(emailService.sendEmailChangedNotice).toHaveBeenCalledWith({
			previousEmail: 'dono@exemplo.com',
			newEmail: 'novo@exemplo.com',
			firstName: 'Ana',
		});
	});

	it('recusa e-mail que já pertence a outra conta', async () => {
		jest.spyOn(UserModel, 'exists').mockResolvedValue({ _id: 'u2' } as any);

		await expect(
			service.update('u1', { email: 'outro@exemplo.com' } as any)
		).rejects.toThrow(ConflictException);
		expect(UserModel.findByIdAndUpdate).not.toHaveBeenCalled();
	});

	it('mesmo e-mail (só caixa diferente) não dispara aviso', async () => {
		await service.update('u1', {
			email: 'DONO@exemplo.com',
			firstName: 'Ana B',
		} as any);

		expect(emailService.sendEmailChangedNotice).not.toHaveBeenCalled();
	});

	it('falha no envio do aviso não desfaz a troca', async () => {
		emailService.sendEmailChangedNotice.mockRejectedValueOnce(
			new Error('resend down')
		);

		const updated: any = await service.update('u1', {
			email: 'novo@exemplo.com',
		} as any);

		expect(updated.email).toBe('novo@exemplo.com');
	});

	it('mascara o e-mail novo no aviso', () => {
		expect(maskEmail('pedro@gmail.com')).toBe('pe***@gmail.com');
		expect(maskEmail('a@b.com')).toBe('a***@b.com');
	});
});
