import { AuditModule } from 'src/audit/audit.module';
import { SECURITY_AUDIT } from './security-audit.service';
import { actorRefOf, emailRefOf } from 'src/audit/infrastructure/actor-ref';
import { SECURITY_EVENT } from 'src/audit/domain/security-events';
import { AuditTrail } from './audit-trail.port';
import { SecurityAuditService } from './security-audit.service';

jest.mock('src/env', () => ({ jwtSecret: 'segredo-de-teste-da-trilha' }));

describe('SecurityAuditService', () => {
	const now = new Date('2026-10-31T12:00:00Z');
	let record: jest.Mock;
	let service: SecurityAuditService;

	beforeEach(() => {
		record = jest.fn().mockResolvedValue(undefined);
		service = new SecurityAuditService({ record } as AuditTrail, () => now);
	});

	it('entrega o evento com pseudônimos e sem dado pessoal', () => {
		service.emit({
			type: SECURITY_EVENT.RoleChanged,
			actor: { userId: 'admin-1' },
			subject: { userId: 'user-1' },
			payload: { from: 'user', to: 'editor' },
		});

		const event = record.mock.calls[0][0];
		expect(event).toMatchObject({
			type: 'security.role.changed',
			version: 1,
			actorRef: actorRefOf('admin-1'),
			subject: actorRefOf('user-1'),
			occurredAt: now,
			payload: { from: 'user', to: 'editor' },
		});
		expect(event.eventId).toMatch(/^[0-9a-f-]{36}$/);
		expect(event.actorRef).toMatch(/^usr_[0-9a-f]{32}$/);
		expect(JSON.stringify(event)).not.toContain('admin-1');
	});

	it('sem subject, o assunto é o próprio ator', () => {
		service.emit({
			type: SECURITY_EVENT.LoginSucceeded,
			actor: { userId: 'u1' },
		});
		const event = record.mock.calls[0][0];
		expect(event.subject).toBe(event.actorRef);
		expect(event.payload).toEqual({});
	});

	it('e-mail digitado vira pseudônimo estável, sem diferenciar caixa nem espaços', () => {
		service.emit({
			type: SECURITY_EVENT.LoginFailed,
			actor: { emailAttempted: ' Pessoa@Exemplo.com ' },
		});
		const event = record.mock.calls[0][0];
		expect(event.actorRef).toBe(emailRefOf('pessoa@exemplo.com'));
		expect(event.actorRef).toMatch(/^eml_[0-9a-f]{32}$/);
		expect(JSON.stringify(event)).not.toContain('xemplo');
	});

	it('o sistema aparece como "system"', () => {
		service.emit({
			type: SECURITY_EVENT.RoleChanged,
			actor: 'system',
			subject: { userId: 'user-1' },
		});
		expect(record.mock.calls[0][0].actorRef).toBe('system');
	});

	it('não espera a trilha: emit volta antes de ela responder', () => {
		record.mockReturnValue(new Promise(() => undefined));
		expect(() =>
			service.emit({
				type: SECURITY_EVENT.LoginSucceeded,
				actor: { userId: 'u1' },
			})
		).not.toThrow();
	});

	it('falha da trilha não vira exceção de quem emitiu', async () => {
		record.mockRejectedValue(new Error('mongo fora'));
		const error = jest
			.spyOn(service['logger'], 'error')
			.mockImplementation(() => undefined);

		service.emit({
			type: SECURITY_EVENT.LoginSucceeded,
			actor: { userId: 'u1' },
		});
		await new Promise((resolve) => setImmediate(resolve));

		expect(error).toHaveBeenCalledWith(expect.stringContaining('mongo fora'));
	});

	it('falha síncrona da trilha também não chega a quem emitiu', () => {
		record.mockImplementation(() => {
			throw new Error('boom');
		});
		const error = jest
			.spyOn(service['logger'], 'error')
			.mockImplementation(() => undefined);
		expect(() =>
			service.emit({
				type: SECURITY_EVENT.LoginSucceeded,
				actor: { userId: 'u1' },
			})
		).not.toThrow();
		expect(error).toHaveBeenCalled();
	});

	// `@Optional()` nos consumidores esconde um erro de fiação: sem este teste,
	// o módulo deixaria de exportar o token e a trilha ficaria muda sem aviso.
	it('o módulo é global e exporta o token usado pelos consumidores', () => {
		expect(Reflect.getMetadata('__module:global__', AuditModule)).toBe(true);
		expect(Reflect.getMetadata('exports', AuditModule)).toContain(
			SECURITY_AUDIT
		);
	});
});
