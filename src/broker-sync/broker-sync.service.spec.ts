import { Test, TestingModule } from '@nestjs/testing';
import { BrokerSyncService } from './broker-sync.service';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { AssetsService } from 'src/assets/assets.service';
import { BrokerConnectionModel } from './schema/broker-connection.model';
import { Types } from 'mongoose';
import { SubscriptionService } from 'src/subscription/subscription.service';
import * as ccxt from 'ccxt';
import { brokerSyncErrorMessage } from 'src/broker-sync/domain/broker-sync-error';

/**
 * O mock agora parte do modulo REAL (`requireActual`) e so troca os
 * construtores de exchange. Antes ele devolvia um objeto com apenas
 * `binance` e `coinbase`, o que deixava as classes de erro da CCXT
 * (`AuthenticationError` e companhia) indefinidas — e a classificacao de
 * erro da TRK-011 e feita justamente sobre elas. Nenhum teste existente
 * depende da ausencia dessas classes.
 */
jest.mock('ccxt', () => {
	const actual = jest.requireActual('ccxt');
	return {
		...actual,
		binance: jest.fn().mockImplementation(() => {
			return {
				fetchBalance: jest.fn().mockResolvedValue({
					total: {
						BTC: 1.5,
						ETH: 10,
						USDT: 0,
					},
				}),
			};
		}),
		coinbase: jest.fn(),
		bitso: jest.fn(),
	};
});

describe('BrokerSyncService', () => {
	let service: BrokerSyncService;
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	let portfolioService: PortfolioService;
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	let assetsService: AssetsService;

	const mockPortfolioService = {
		findPortfolioByName: jest.fn(),
		createPortfolio: jest.fn(),
		addAssetToPortfolio: jest.fn(),
	};

	const mockAssetsService = {
		findAssetBySymbolAndPortfolio: jest.fn(),
		update: jest.fn(),
	};

	const mockSubscriptionService = {
		findCurrentSubscriptionByUser: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				BrokerSyncService,
				{
					provide: PortfolioService,
					useValue: mockPortfolioService,
				},
				{
					provide: AssetsService,
					useValue: mockAssetsService,
				},
				{
					provide: SubscriptionService,
					useValue: mockSubscriptionService,
				},
			],
		}).compile();

		service = module.get<BrokerSyncService>(BrokerSyncService);
		portfolioService = module.get<PortfolioService>(PortfolioService);
		assetsService = module.get<AssetsService>(AssetsService);

		jest.clearAllMocks();
	});

	it('should be defined', () => {
		expect(service).toBeDefined();
	});

	it('should sync binance successfully', async () => {
		const userId = new Types.ObjectId().toString();
		const provider = 'binance';

		const mockConnection = {
			userId: new Types.ObjectId(userId),
			provider,
			apiKeyEncrypted: 'iv:encryptedKey',
			apiSecretEncrypted: 'iv:encryptedSecret',
			status: 'connected',
			save: jest.fn().mockResolvedValue(true),
		};

		// Mock cryptografia
		jest.spyOn(service as any, 'decrypt').mockReturnValue('decryptedValue');

		// Mock subscription
		mockSubscriptionService.findCurrentSubscriptionByUser.mockResolvedValue({
			status: 'active',
		});

		const selectSpy = jest.fn().mockReturnThis();
		const findOneSpy = jest
			.spyOn(BrokerConnectionModel, 'findOne')
			.mockReturnValue({
				select: selectSpy,
				exec: jest.fn().mockResolvedValue(mockConnection),
			} as any);

		// O método agora encadeia .select(), que retorna o próprio query (ou algo que tenha .then)
		// Para simplificar, vamos fazer o selectSpy retornar um objeto que o await consiga processar
		selectSpy.mockResolvedValue(mockConnection);

		const mockPortfolio = {
			_id: new Types.ObjectId(),
			name: provider,
		};
		mockPortfolioService.findPortfolioByName.mockResolvedValue(mockPortfolio);

		mockAssetsService.findAssetBySymbolAndPortfolio
			.mockResolvedValueOnce({
				_id: new Types.ObjectId(),
				symbol: 'BTC',
				price: 50000,
			})
			.mockResolvedValueOnce(null); // ETH será novo

		const result = await service.syncConnection(userId, provider);

		expect(result.syncedAssets).toBe(2);
		expect(result.message).toBe('Sincronização com binance concluída.');
		expect(findOneSpy).toHaveBeenCalledWith({
			userId: new Types.ObjectId(userId),
			provider,
		});
		expect(selectSpy).toHaveBeenCalledWith(
			'+apiKeyEncrypted +apiSecretEncrypted +apiPassphraseEncrypted'
		);
		expect(mockPortfolioService.addAssetToPortfolio).toHaveBeenCalledTimes(1);
		expect(mockAssetsService.update).toHaveBeenCalledTimes(1);
		expect(mockConnection.save).toHaveBeenCalled();
	});

	it('should throw PLANO_UPGRADE_NECESSARIO if no active subscription', async () => {
		const userId = new Types.ObjectId().toString();
		const provider = 'binance';

		mockSubscriptionService.findCurrentSubscriptionByUser.mockResolvedValue(
			null
		);

		await expect(service.syncConnection(userId, provider)).rejects.toThrow(
			'PLANO_UPGRADE_NECESSARIO'
		);
	});

	it('should extract balances from free/used/info when total is empty', () => {
		const extracted = (service as any).extractPositiveBalances({
			total: {},
			free: { btc: '0.10', ETH: 0 },
			used: { BTC: '0.20', USDT: '0' },
			info: {
				balances: [
					{ asset: 'BTC', free: '0.15', locked: '0.05' },
					{ asset: 'SOL', free: '3.5', locked: '0' },
				],
			},
		});

		expect(extracted.BTC).toBeCloseTo(0.3, 8);
		expect(extracted.SOL).toBe(3.5);
		expect(extracted.ETH).toBeUndefined();
		expect(extracted.USDT).toBeUndefined();
	});

	describe('erro da corretora nao e persistido cru (TRK-011)', () => {
		const API_KEY = 'AKIAVAZAMENTO1234567890';

		// `bitso`, nao `binance`: o caminho da Binance engole a falha de cada
		// carteira de proposito (spot/funding/margin) e cai no fallback, entao
		// ele nunca chega ao catch que grava o erro. Qualquer outro provider
		// usa o `fetchBalance()` direto, que e o caminho sob teste aqui.
		it('grava categoria e mensagem propria, nunca o texto da exchange', async () => {
			const userId = new Types.ObjectId().toString();
			const provider = 'bitso';

			const mockConnection: any = {
				userId: new Types.ObjectId(userId),
				provider,
				apiKeyEncrypted: 'iv:encryptedKey',
				apiSecretEncrypted: 'iv:encryptedSecret',
				status: 'connected',
				save: jest.fn().mockResolvedValue(true),
			};

			jest.spyOn(service as any, 'decrypt').mockReturnValue('decryptedValue');
			mockSubscriptionService.findCurrentSubscriptionByUser.mockResolvedValue({
				status: 'active',
			});

			const selectSpy = jest.fn().mockResolvedValue(mockConnection);
			jest.spyOn(BrokerConnectionModel, 'findOne').mockReturnValue({
				select: selectSpy,
			} as any);

			// A exchange ecoa a URL da requisicao — e a URL carrega a API key.
			const erroDaExchange: any = new ccxt.AuthenticationError(
				`bitso GET https://api.bitso.com/v3/balance?apiKey=${API_KEY} 401 Invalid API-key`
			);
			erroDaExchange.httpStatus = 401;
			(ccxt.bitso as unknown as jest.Mock).mockImplementation(() => ({
				fetchBalance: jest.fn().mockRejectedValue(erroDaExchange),
			}));

			await expect(service.syncConnection(userId, provider)).rejects.toThrow(
				brokerSyncErrorMessage('invalid_credentials')
			);

			expect(mockConnection.save).toHaveBeenCalled();
			expect(mockConnection.status).toBe('error');
			expect(mockConnection.lastErrorCode).toBe('invalid_credentials');
			expect(mockConnection.lastErrorStatus).toBe(401);
			expect(mockConnection.lastError).toBe(
				brokerSyncErrorMessage('invalid_credentials')
			);

			// O teste que importa: nada do texto original encostou no documento.
			const persistido = JSON.stringify(mockConnection);
			expect(persistido).not.toContain(API_KEY);
			expect(persistido).not.toContain('api.bitso.com');
			expect(persistido).not.toContain('Invalid API-key');
		});

		it('nao devolve o texto cru de linhas gravadas antes da correcao', async () => {
			const userId = new Types.ObjectId().toString();

			jest.spyOn(BrokerConnectionModel, 'find').mockResolvedValue([
				{
					_id: new Types.ObjectId(),
					provider: 'binance',
					status: 'error',
					lastSync: null,
					cpf: null,
					// Linha legada: texto cru, sem categoria ao lado.
					lastError: `binance GET https://api.binance.com/api/v3/account?apiKey=${API_KEY} 401 Invalid API-key`,
				},
			] as any);

			const [conexao] = await service.getConnections(userId);

			expect(conexao.lastError).toBe(brokerSyncErrorMessage('unknown'));
			expect(conexao.lastErrorCode).toBeNull();
			expect(JSON.stringify(conexao)).not.toContain(API_KEY);
		});

		it('conexao sem erro continua devolvendo lastError null', async () => {
			const userId = new Types.ObjectId().toString();

			jest.spyOn(BrokerConnectionModel, 'find').mockResolvedValue([
				{
					_id: new Types.ObjectId(),
					provider: 'binance',
					status: 'connected',
					lastSync: new Date(),
					cpf: null,
				},
			] as any);

			const [conexao] = await service.getConnections(userId);

			expect(conexao.lastError).toBeNull();
			expect(conexao.lastErrorCode).toBeNull();
		});
	});
});
