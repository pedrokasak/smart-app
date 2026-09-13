import { BadRequestException } from '@nestjs/common';
import {
	BREACHED_PASSWORD_MESSAGE,
	BreachedPasswordPolicy,
} from './breached-password.policy';
import { BreachedPasswordVerdict } from './ports/breached-password-checker.port';

function policyCom(verdict: BreachedPasswordVerdict) {
	const check = jest.fn().mockResolvedValue(verdict);
	return { policy: new BreachedPasswordPolicy({ check }), check };
}

describe('BreachedPasswordPolicy (TRK-012)', () => {
	it('recusa senha encontrada em vazamento', async () => {
		const { policy } = policyCom('breached');

		await expect(policy.assertNotBreached('Password123@')).rejects.toThrow(
			BadRequestException
		);
	});

	it('a mensagem diz o que aconteceu e o que fazer', async () => {
		const { policy } = policyCom('breached');

		// "Senha inválida" seria inútil: a senha atende todo o formato exigido
		// e o usuário não teria como adivinhar o motivo da recusa.
		await expect(policy.assertNotBreached('Password123@')).rejects.toThrow(
			BREACHED_PASSWORD_MESSAGE
		);
		expect(BREACHED_PASSWORD_MESSAGE).toMatch(/vazamentos públicos/i);
		expect(BREACHED_PASSWORD_MESSAGE).toMatch(/escolha outra senha/i);
	});

	it('aceita senha ausente do corpus', async () => {
		const { policy } = policyCom('not_breached');

		await expect(
			policy.assertNotBreached('Password123@')
		).resolves.toBeUndefined();
	});

	describe('falha aberta', () => {
		it('checagem indisponivel NAO bloqueia — este e o ponto', async () => {
			// `unknown` é exatamente o que o adaptador devolve quando o HIBP
			// está fora do ar. Bloquear aqui trocaria um ganho pequeno de
			// segurança por indisponibilidade do cadastro — e daria ao atacante
			// um jeito de derrubar o produto derrubando um serviço de terceiro.
			const { policy } = policyCom('unknown');

			await expect(
				policy.assertNotBreached('Password123@')
			).resolves.toBeUndefined();
		});

		it('mas registra que a checagem nao aconteceu', async () => {
			const { policy } = policyCom('unknown');
			const warn = jest
				.spyOn((policy as any).logger, 'warn')
				.mockImplementation(() => undefined);

			await policy.assertNotBreached('Password123@');

			expect(warn).toHaveBeenCalledTimes(1);
			// Nunca a senha no log.
			expect(warn.mock.calls.flat().join(' ')).not.toContain('Password123@');
		});
	});

	it('senha vazia nao chega a consultar nada', async () => {
		const { policy, check } = policyCom('breached');

		await expect(policy.assertNotBreached('')).resolves.toBeUndefined();
		expect(check).not.toHaveBeenCalled();
	});
});
