import * as ccxt from 'ccxt';
import {
	brokerErrorLogLabel,
	classifyBrokerError,
} from './ccxt-error-classifier';
import { brokerSyncErrorMessage } from 'src/broker-sync/domain/broker-sync-error';

/**
 * A CCXT NAO e mockada aqui de proposito: o valor deste teste esta em usar as
 * classes de erro reais da biblioteca. Se uma versao futura mexer na
 * hierarquia (mover `RateLimitExceeded` para fora de `NetworkError`, por
 * exemplo), este arquivo quebra — que e o ponto.
 */
describe('classifyBrokerError (TRK-011)', () => {
	describe('mapeamento por tipo da CCXT', () => {
		const casos: Array<[string, Error, string]> = [
			[
				'AuthenticationError',
				new ccxt.AuthenticationError('boom'),
				'invalid_credentials',
			],
			[
				'PermissionDenied',
				new ccxt.PermissionDenied('boom'),
				'permission_denied',
			],
			[
				'AccountSuspended',
				new ccxt.AccountSuspended('boom'),
				'account_suspended',
			],
			['RateLimitExceeded', new ccxt.RateLimitExceeded('boom'), 'rate_limited'],
			['DDoSProtection', new ccxt.DDoSProtection('boom'), 'rate_limited'],
			[
				'ExchangeNotAvailable',
				new ccxt.ExchangeNotAvailable('boom'),
				'exchange_unavailable',
			],
			['OnMaintenance', new ccxt.OnMaintenance('boom'), 'exchange_unavailable'],
			['RequestTimeout', new ccxt.RequestTimeout('boom'), 'network_timeout'],
			['InvalidNonce', new ccxt.InvalidNonce('boom'), 'clock_skew'],
			['NetworkError', new ccxt.NetworkError('boom'), 'network_error'],
			['BadRequest', new ccxt.BadRequest('boom'), 'invalid_request'],
			['BadSymbol', new ccxt.BadSymbol('boom'), 'invalid_request'],
			['ExchangeError', new ccxt.ExchangeError('boom'), 'exchange_error'],
		];

		it.each(casos)('%s -> %s', (_nome, erro, categoriaEsperada) => {
			expect(classifyBrokerError(erro).category).toBe(categoriaEsperada);
		});

		it('prefere a subclasse: PermissionDenied nao vira invalid_credentials', () => {
			// PermissionDenied herda de AuthenticationError. Se a ordem da tabela
			// se inverter, o usuario recebe "troque a chave" para um problema de
			// escopo — instrucao errada, e ele troca a chave a toa.
			expect(new ccxt.PermissionDenied('x')).toBeInstanceOf(
				ccxt.AuthenticationError
			);
			expect(classifyBrokerError(new ccxt.PermissionDenied('x')).category).toBe(
				'permission_denied'
			);
		});

		it('erro fora da hierarquia da CCXT cai em unknown', () => {
			expect(classifyBrokerError(new Error('qualquer coisa')).category).toBe(
				'unknown'
			);
			expect(classifyBrokerError(undefined).category).toBe('unknown');
			expect(classifyBrokerError('string solta').category).toBe('unknown');
		});
	});

	describe('nenhum texto do provedor sobrevive', () => {
		/**
		 * O cenario da issue: a exchange ecoa a URL da requisicao dentro da
		 * mensagem, e a URL carrega a API key.
		 */
		const API_KEY = 'AKIAVAZAMENTO1234567890';
		const erroComChave = new ccxt.AuthenticationError(
			`binance GET https://api.binance.com/api/v3/account?apiKey=${API_KEY}&timestamp=1 401 Invalid API-key`
		);

		it('a saida nao contem a chave', () => {
			const sanitized = classifyBrokerError(erroComChave);

			expect(JSON.stringify(sanitized)).not.toContain(API_KEY);
			expect(JSON.stringify(sanitized)).not.toContain('api.binance.com');
		});

		it('a saida nao contem nenhum pedaco da mensagem original', () => {
			const sanitized = classifyBrokerError(erroComChave);

			expect(sanitized.message).toBe(
				brokerSyncErrorMessage('invalid_credentials')
			);
			expect(sanitized.message).not.toContain('Invalid API-key');
			// A superficie persistida e exatamente: categoria, mensagem, status.
			expect(Object.keys(sanitized).sort()).toEqual(['category', 'message']);
		});

		it('o log tambem nao carrega a mensagem do provedor', () => {
			const sanitized = classifyBrokerError(erroComChave);
			const label = brokerErrorLogLabel(erroComChave, sanitized);

			expect(label).not.toContain(API_KEY);
			expect(label).not.toContain('Invalid API-key');
			// ...mas continua util para quem debuga.
			expect(label).toContain('categoria=invalid_credentials');
			expect(label).toContain('tipo=AuthenticationError');
		});
	});

	describe('status HTTP', () => {
		it('e preservado quando a corretora respondeu com um', () => {
			const erro: any = new ccxt.AuthenticationError('nope');
			erro.httpStatus = 401;

			const sanitized = classifyBrokerError(erro);
			expect(sanitized.statusCode).toBe(401);
			expect(brokerErrorLogLabel(erro, sanitized)).toContain('status=401');
		});

		it('le tambem de response.status (erros embrulhados por axios)', () => {
			const erro: any = new ccxt.ExchangeError('nope');
			erro.response = { status: 503 };

			expect(classifyBrokerError(erro).statusCode).toBe(503);
		});

		it('ignora valor que nao e status HTTP plausivel', () => {
			const erro: any = new ccxt.ExchangeError('nope');
			erro.status = 'error';

			expect(classifyBrokerError(erro).statusCode).toBeUndefined();
		});
	});

	describe('chave em formato invalido (Coinbase/PEM)', () => {
		/**
		 * Este erro vem do `crypto` do Node, nao da CCXT, e chega embrulhado em
		 * ExchangeError. Sem o tratamento dedicado ele viraria `exchange_error`
		 * e o usuario perderia a unica instrucao acionavel que existe: "cole a
		 * chave em PEM".
		 */
		it.each([
			'Illegal character at offset 4',
			'Unsupported key format',
			'error:1E08010C:DECODER routines::unsupported',
		])('reconhece "%s"', (mensagem) => {
			expect(
				classifyBrokerError(new ccxt.ExchangeError(mensagem)).category
			).toBe('invalid_key_format');
		});

		it('a mensagem devolvida e a nossa, nao a do crypto', () => {
			const sanitized = classifyBrokerError(
				new ccxt.ExchangeError('Illegal character at offset 4')
			);

			expect(sanitized.message).toBe(
				brokerSyncErrorMessage('invalid_key_format')
			);
			expect(sanitized.message).not.toContain('Illegal character');
		});
	});
});
