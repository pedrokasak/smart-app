import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { HibpBreachedPasswordAdapter } from './hibp-breached-password.adapter';

/**
 * SHA-1 de "Trackerr@2026!":
 *   70682205639C07823B4AFF8EA1D1CF982A0F51A6
 * prefixo (5) = 70682   sufixo (35) = 205639C07823B4AFF8EA1D1CF982A0F51A6
 *
 * NAO usar "password" (o exemplo da documentacao do HIBP) como senha de
 * teste: a assercao "a senha nao aparece no que foi enviado" casaria com o
 * proprio dominio `api.pwnedpasswords.com` e passaria/falharia por acidente.
 */
const SENHA = 'Trackerr@2026!';
const DIGEST = '70682205639C07823B4AFF8EA1D1CF982A0F51A6';
const PREFIXO = '70682';
const SUFIXO = '205639C07823B4AFF8EA1D1CF982A0F51A6';

function criarAdapter(get: jest.Mock) {
	return new HibpBreachedPasswordAdapter({ get } as unknown as HttpService);
}

describe('HibpBreachedPasswordAdapter (TRK-012)', () => {
	describe('k-anonimato: so o prefixo sai do processo', () => {
		it('a URL leva exatamente 5 caracteres hexadecimais do hash', async () => {
			const get = jest.fn().mockReturnValue(of({ data: '' }));

			await criarAdapter(get).check(SENHA);

			const [url] = get.mock.calls[0];
			expect(url).toBe(`https://api.pwnedpasswords.com/range/${PREFIXO}`);
			expect(url.split('/').pop()).toHaveLength(
				HibpBreachedPasswordAdapter.PREFIX_LENGTH
			);
		});

		it('nem a senha, nem o hash completo, nem o sufixo atravessam a rede', async () => {
			const get = jest.fn().mockReturnValue(of({ data: '' }));

			await criarAdapter(get).check(SENHA);

			// Tudo que foi passado ao cliente HTTP — URL, headers, opcoes.
			const enviado = JSON.stringify(get.mock.calls[0]);
			expect(enviado).not.toContain(SENHA);
			expect(enviado).not.toContain(DIGEST);
			expect(enviado).not.toContain(SUFIXO);
			expect(enviado).toContain(PREFIXO);
		});

		it('pede padding, para que o tamanho da resposta nao entregue nada', async () => {
			const get = jest.fn().mockReturnValue(of({ data: '' }));

			await criarAdapter(get).check(SENHA);

			const [, config] = get.mock.calls[0];
			expect(config.headers['Add-Padding']).toBe('true');
		});
	});

	describe('veredito', () => {
		it('senha presente no corpus e "breached"', async () => {
			const get = jest.fn().mockReturnValue(
				of({
					data: [
						'0018A45C4D1DEF81644B54AB7F969B88D65:1',
						`${SUFIXO}:9659365`,
						'00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2',
					].join('\r\n'),
				})
			);

			await expect(criarAdapter(get).check(SENHA)).resolves.toBe('breached');
		});

		it('senha ausente do corpus e "not_breached"', async () => {
			const get = jest.fn().mockReturnValue(
				of({
					data: [
						'0018A45C4D1DEF81644B54AB7F969B88D65:1',
						'00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2',
					].join('\r\n'),
				})
			);

			await expect(criarAdapter(get).check(SENHA)).resolves.toBe(
				'not_breached'
			);
		});

		it('entrada de padding (contagem 0) NAO conta como vazamento', async () => {
			// Sem este cuidado, o padding pedido no header viraria falso
			// positivo e o cadastro recusaria senha boa.
			const get = jest
				.fn()
				.mockReturnValue(of({ data: `${SUFIXO}:0\r\nAAAA:0` }));

			await expect(criarAdapter(get).check(SENHA)).resolves.toBe(
				'not_breached'
			);
		});

		it('corpo vazio nao quebra a leitura', async () => {
			const get = jest.fn().mockReturnValue(of({ data: undefined }));

			await expect(criarAdapter(get).check(SENHA)).resolves.toBe(
				'not_breached'
			);
		});
	});

	describe('falha aberta', () => {
		it('HIBP fora do ar devolve "unknown" em vez de lancar', async () => {
			const get = jest
				.fn()
				.mockReturnValue(
					throwError(() =>
						Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
					)
				);

			await expect(criarAdapter(get).check(SENHA)).resolves.toBe('unknown');
		});

		it('timeout devolve "unknown"', async () => {
			const get = jest.fn().mockReturnValue(
				throwError(() =>
					Object.assign(new Error('timeout of 2000ms exceeded'), {
						code: 'ECONNABORTED',
					})
				)
			);

			await expect(criarAdapter(get).check(SENHA)).resolves.toBe('unknown');
		});

		it('o log da falha nao carrega senha, hash nem prefixo', async () => {
			const get = jest
				.fn()
				.mockReturnValue(throwError(() => new Error('boom')));
			const adapter = criarAdapter(get);
			const warn = jest
				.spyOn((adapter as any).logger, 'warn')
				.mockImplementation(() => undefined);

			await adapter.check(SENHA);

			const registrado = warn.mock.calls.flat().join(' ');
			expect(registrado).not.toContain(SENHA);
			expect(registrado).not.toContain(DIGEST);
			expect(registrado).not.toContain(PREFIXO);
		});
	});

	describe('timeout', () => {
		const original = process.env.HIBP_TIMEOUT_MS;
		afterEach(() => {
			if (original === undefined) delete process.env.HIBP_TIMEOUT_MS;
			else process.env.HIBP_TIMEOUT_MS = original;
		});

		it('usa 2s por padrao', async () => {
			delete process.env.HIBP_TIMEOUT_MS;
			const get = jest.fn().mockReturnValue(of({ data: '' }));

			await criarAdapter(get).check(SENHA);

			expect(get.mock.calls[0][1].timeout).toBe(2000);
		});

		it('respeita HIBP_TIMEOUT_MS', async () => {
			process.env.HIBP_TIMEOUT_MS = '500';
			const get = jest.fn().mockReturnValue(of({ data: '' }));

			await criarAdapter(get).check(SENHA);

			expect(get.mock.calls[0][1].timeout).toBe(500);
		});

		it('ignora valor invalido e volta ao padrao', async () => {
			process.env.HIBP_TIMEOUT_MS = 'nao-e-numero';
			const get = jest.fn().mockReturnValue(of({ data: '' }));

			await criarAdapter(get).check(SENHA);

			expect(get.mock.calls[0][1].timeout).toBe(2000);
		});
	});
});
