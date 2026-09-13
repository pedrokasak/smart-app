import { createHash } from 'node:crypto';
import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import {
	BreachedPasswordChecker,
	BreachedPasswordVerdict,
} from 'src/authentication/application/ports/breached-password-checker.port';

/**
 * Have I Been Pwned — range API (TRK-012).
 *
 * A SENHA NUNCA SAI DAQUI. O protocolo e k-anonimato: calcula-se o SHA-1 da
 * senha, e apenas os 5 PRIMEIROS caracteres hexadecimais do hash vao na URL.
 * O servico devolve todos os sufixos que comecam com aquele prefixo (na
 * ordem de centenas de linhas) e a comparacao acontece aqui dentro. Nem a
 * senha, nem o hash completo, nem nada que identifique o usuario atravessa a
 * rede.
 *
 * SHA-1 aqui nao e escolha de seguranca — e o formato do corpus publico. A
 * senha continua guardada em Argon2id; este hash e descartavel e existe so
 * para casar com uma lista.
 *
 * `Add-Padding: true` faz o servico completar a resposta com entradas falsas
 * de contagem zero, para que o TAMANHO da resposta nao entregue quantos
 * sufixos reais existem para aquele prefixo. Por isso as entradas com
 * contagem 0 sao descartadas na leitura — sem isso, o padding viraria
 * "vazada" e o cadastro recusaria senha boa.
 *
 * TIMEOUT CURTO (2s por padrao): tem gente esperando a tela de cadastro
 * responder. Estourou, o veredito e `unknown` e a politica deixa passar.
 */
@Injectable()
export class HibpBreachedPasswordAdapter implements BreachedPasswordChecker {
	private readonly logger = new Logger(HibpBreachedPasswordAdapter.name);

	private static readonly BASE_URL = 'https://api.pwnedpasswords.com/range';
	private static readonly DEFAULT_TIMEOUT_MS = 2000;
	/** k-anonimato: o tamanho do prefixo e o parametro do protocolo. */
	static readonly PREFIX_LENGTH = 5;

	constructor(private readonly httpService: HttpService) {}

	private get timeoutMs(): number {
		const parsed = Number(process.env.HIBP_TIMEOUT_MS);
		return Number.isFinite(parsed) && parsed > 0
			? parsed
			: HibpBreachedPasswordAdapter.DEFAULT_TIMEOUT_MS;
	}

	/**
	 * Exposto para o teste: e a garantia mecanica de que a URL montada leva
	 * 5 caracteres e nada mais.
	 */
	static prefixOf(password: string): string {
		return createHash('sha1')
			.update(password, 'utf8')
			.digest('hex')
			.toUpperCase()
			.slice(0, HibpBreachedPasswordAdapter.PREFIX_LENGTH);
	}

	async check(password: string): Promise<BreachedPasswordVerdict> {
		if (!password) return 'not_breached';

		const digest = createHash('sha1')
			.update(password, 'utf8')
			.digest('hex')
			.toUpperCase();
		const prefix = digest.slice(0, HibpBreachedPasswordAdapter.PREFIX_LENGTH);
		const suffix = digest.slice(HibpBreachedPasswordAdapter.PREFIX_LENGTH);

		try {
			const response = await firstValueFrom(
				this.httpService.get<string>(
					`${HibpBreachedPasswordAdapter.BASE_URL}/${prefix}`,
					{
						timeout: this.timeoutMs,
						responseType: 'text',
						headers: {
							// Esconde o tamanho real da resposta (ver acima).
							'Add-Padding': 'true',
							// O HIBP pede identificacao do cliente.
							'User-Agent': 'trackerr-server',
						},
					}
				)
			);

			return this.matches(String(response?.data ?? ''), suffix)
				? 'breached'
				: 'not_breached';
		} catch (error) {
			// Sem senha, sem hash, sem prefixo no log: nada que estreite a
			// busca de quem tiver acesso ao log depois.
			this.logger.warn(
				`HIBP indisponível (${(error as { code?: string })?.code || 'erro'}); ` +
					'a senha seguiu sem checagem de vazamento.'
			);
			return 'unknown';
		}
	}

	/**
	 * Corpo no formato `SUFIXO:CONTAGEM`, uma linha por entrada. Contagem 0 e
	 * padding — descartada.
	 */
	private matches(body: string, suffix: string): boolean {
		for (const line of body.split('\n')) {
			const [candidate, rawCount] = line.trim().split(':');
			if (!candidate || candidate.toUpperCase() !== suffix) continue;
			return Number(rawCount) > 0;
		}
		return false;
	}
}
