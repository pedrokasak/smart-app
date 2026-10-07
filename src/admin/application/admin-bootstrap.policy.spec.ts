import { INITIAL_ADMIN_EMAIL } from '../constants/admin.constants';
import {
	bootstrapAdminEmail,
	canBootstrapAdmin,
	isBootstrapAdminEmail,
} from './admin-bootstrap.policy';

describe('admin-bootstrap.policy (TRA-184)', () => {
	it('usa a constante quando ADMIN_BOOTSTRAP_EMAIL não está definida', () => {
		expect(bootstrapAdminEmail({})).toBe(INITIAL_ADMIN_EMAIL);
	});

	it('prefere ADMIN_BOOTSTRAP_EMAIL, normalizando caixa e espaços', () => {
		expect(
			bootstrapAdminEmail({ ADMIN_BOOTSTRAP_EMAIL: '  Dono@Exemplo.com ' })
		).toBe('dono@exemplo.com');
	});

	it('ignora ADMIN_BOOTSTRAP_EMAIL em branco', () => {
		expect(bootstrapAdminEmail({ ADMIN_BOOTSTRAP_EMAIL: '   ' })).toBe(
			INITIAL_ADMIN_EMAIL
		);
	});

	it('compara e-mail sem diferenciar caixa e rejeita vazio', () => {
		const env = { ADMIN_BOOTSTRAP_EMAIL: 'dono@exemplo.com' };
		expect(isBootstrapAdminEmail('DONO@exemplo.com', env)).toBe(true);
		expect(isBootstrapAdminEmail('outro@exemplo.com', env)).toBe(false);
		expect(isBootstrapAdminEmail('', env)).toBe(false);
		expect(isBootstrapAdminEmail(undefined, env)).toBe(false);
	});

	it('só promove quem tem o e-mail verificado', () => {
		const env = { ADMIN_BOOTSTRAP_EMAIL: 'dono@exemplo.com' };
		expect(
			canBootstrapAdmin(
				{ email: 'dono@exemplo.com', isEmailVerified: true },
				env
			)
		).toBe(true);
		expect(
			canBootstrapAdmin(
				{ email: 'dono@exemplo.com', isEmailVerified: false },
				env
			)
		).toBe(false);
		expect(canBootstrapAdmin({ email: 'dono@exemplo.com' }, env)).toBe(false);
		expect(
			canBootstrapAdmin({ email: 'x@exemplo.com', isEmailVerified: true }, env)
		).toBe(false);
	});
});
