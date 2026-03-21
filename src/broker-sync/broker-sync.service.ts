import {
	BadRequestException,
	Injectable,
	NotFoundException,
	Logger,
} from '@nestjs/common';
import { BrokerConnectionModel } from './schema/broker-connection.model';
import { BrokerConnectDto } from './dto/broker-connect.dto';
import * as crypto from 'crypto';
import { Types } from 'mongoose';
import * as ccxt from 'ccxt';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { AssetsService } from 'src/assets/assets.service';
import { UserModel } from 'src/users/schema/user.model';
import { ProviderRegistry } from 'src/broker-sync/providers/provider-registry';
import { SubscriptionService } from 'src/subscription/subscription.service';

const ENCRYPTION_KEY =
	process.env.BROKER_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef'; // 32 bytes
const IV_LENGTH = 16;

@Injectable()
export class BrokerSyncService {
	constructor(
		private readonly portfolioService: PortfolioService,
		private readonly assetsService: AssetsService,
		private readonly subscriptionService: SubscriptionService
	) {}

	private readonly logger = new Logger(BrokerSyncService.name);

	private readonly providerRegistry = new ProviderRegistry();

	private encrypt(text: string): string {
		const iv = crypto.randomBytes(IV_LENGTH);
		const cipher = crypto.createCipheriv(
			'aes-256-cbc',
			Buffer.from(ENCRYPTION_KEY),
			iv
		);
		let encrypted = cipher.update(text, 'utf8', 'hex');
		encrypted += cipher.final('hex');
		return iv.toString('hex') + ':' + encrypted;
	}

	private decrypt(text: string): string {
		const [ivHex, encrypted] = text.split(':');
		const iv = Buffer.from(ivHex, 'hex');
		const decipher = crypto.createDecipheriv(
			'aes-256-cbc',
			Buffer.from(ENCRYPTION_KEY),
			iv
		);
		let decrypted = decipher.update(encrypted, 'hex', 'utf8');
		decrypted += decipher.final('utf8');
		return decrypted;
	}

	async getConnections(userId: string) {
		const connections = await BrokerConnectionModel.find(
			{ userId: new Types.ObjectId(userId) },
			{ apiKeyEncrypted: 0, apiSecretEncrypted: 0 }
		);
		return connections.map((c) => ({
			id: c._id,
			provider: c.provider,
			status: c.status,
			lastSync: c.lastSync,
			hasCpf: !!c.cpf,
			lastError: c.lastError || null,
		}));
	}

	async connect(userId: string, dto: BrokerConnectDto) {
		const existing = await BrokerConnectionModel.findOne({
			userId: new Types.ObjectId(userId),
			provider: dto.provider,
		});

		const payload: any = {
			userId: new Types.ObjectId(userId),
			provider: dto.provider,
			status: 'connected',
			lastError: null,
		};

		if (dto.apiKey) payload.apiKeyEncrypted = this.encrypt(dto.apiKey);
		if (dto.apiSecret) payload.apiSecretEncrypted = this.encrypt(dto.apiSecret);
		if (dto.cpf) payload.cpf = dto.cpf;

		if (existing) {
			Object.assign(existing, payload);
			await existing.save();
			return {
				message: `Conexão com ${dto.provider} atualizada.`,
				id: existing._id,
			};
		}

		const connection = await BrokerConnectionModel.create(payload);
		return {
			message: `${dto.provider} conectado com sucesso!`,
			id: connection._id,
		};
	}

	async syncConnection(userId: string, provider: string) {
		const sub =
			await this.subscriptionService.findCurrentSubscriptionByUser(userId);
		if (!sub) {
			throw new BadRequestException('PLANO_UPGRADE_NECESSARIO');
		}

		const connection = await BrokerConnectionModel.findOne({
			userId: new Types.ObjectId(userId),
			provider,
		}).select('+apiKeyEncrypted +apiSecretEncrypted');

		if (!connection) {
			throw new NotFoundException(`Conexão com ${provider} não encontrada.`);
		}

		const providerImpl = this.providerRegistry.get(provider);
		if (!providerImpl) {
			throw new BadRequestException(
				`Provider ${provider} não suportado para sincronização no momento.`
			);
		}

		if (!connection.apiKeyEncrypted || !connection.apiSecretEncrypted) {
			throw new BadRequestException(
				'Chaves de API ausentes para esta conexão.'
			);
		}

		const apiKey = this.decrypt(connection.apiKeyEncrypted);
		const secret = this.decrypt(connection.apiSecretEncrypted);

		let exchange: ccxt.Exchange;
		try {
			exchange = providerImpl.createClient({ apiKey, secret });
		} catch (error) {
			throw new BadRequestException(
				`Erro ao instanciar corretora: ${error.message}`
			);
		}

		try {
			let totalBalances: Record<string, number> = {};

			if (provider === 'binance') {
				// Para Binance, tentamos consolidar Spot, Funding e Margin se possível
				const walletTypes = ['spot', 'funding', 'margin'];
				for (const type of walletTypes) {
					try {
						const bal = await exchange.fetchBalance({ type });
						const total = bal.total || {};
						for (const symbol in total) {
							if (total[symbol] > 0) {
								totalBalances[symbol] =
									(totalBalances[symbol] || 0) + total[symbol];
							}
						}
					} catch (e) {
						this.logger.warn(
							`Erro ao buscar balance ${type} na Binance: ${e.message}`
						);
					}
				}

				// Fallback: algumas contas/chaves não suportam "type" por wallet.
				// Nesse caso, tentamos o saldo padrão da exchange.
				if (Object.keys(totalBalances).length === 0) {
					try {
						const fallbackBalance = await exchange.fetchBalance();
						const fallbackTotal =
							(fallbackBalance.total as unknown as Record<string, number>) ||
							{};
						for (const symbol in fallbackTotal) {
							if (fallbackTotal[symbol] > 0) {
								totalBalances[symbol] =
									(totalBalances[symbol] || 0) + fallbackTotal[symbol];
							}
						}
					} catch (e) {
						this.logger.warn(
							`Erro no fallback fetchBalance() da Binance: ${e.message}`
						);
					}
				}
			} else {
				const balance = await exchange.fetchBalance();
				totalBalances =
					(balance.total as unknown as Record<string, number>) || {};
			}

			const positiveAssets = Object.keys(totalBalances).filter(
				(symbol) => totalBalances[symbol] > 0
			);

			this.logger.log(
				`Sincronizando ${provider} para usuário ${userId}. Ativos encontrados com saldo: ${positiveAssets.length}`
			);

			const quoteCandidates = ['USDT', 'USD', 'USDC'];
			const tryGetQuote = async (base: string): Promise<number | null> => {
				for (const quote of quoteCandidates) {
					const market = `${base}/${quote}`;
					try {
						const ticker = await exchange.fetchTicker(market);
						const last = ticker?.last;
						if (typeof last === 'number' && Number.isFinite(last) && last > 0) {
							return last;
						}
					} catch {
						// ignore
					}
				}
				return null;
			};

			let portfolio = await this.portfolioService.findPortfolioByName(
				userId,
				provider
			);
			if (!portfolio) {
				const userPortfolios =
					await this.portfolioService.getUserPortfolios(userId);
				// Evita falha por limite de planos (ex.: free com 1 carteira):
				// se já existe carteira do usuário, reutilizamos a primeira para sincronização.
				if (userPortfolios.length > 0) {
					portfolio = userPortfolios[0];
				} else {
					const user = await UserModel.findById(userId);
					portfolio = await this.portfolioService.createPortfolio(userId, {
						name: provider,
						ownerType: 'self',
						ownerName: 'Autosync',
						...(connection.cpf || user?.cpf
							? { cpf: connection.cpf || user?.cpf }
							: {}),
					});
				}
			}

			let syncedCount = 0;
			for (const symbol of positiveAssets) {
				const quantity = totalBalances[symbol];
				const assetCode = symbol;

				const existingAsset =
					await this.assetsService.findAssetBySymbolAndPortfolio(
						portfolio._id.toString(),
						assetCode
					);

				if (existingAsset) {
					await this.assetsService.update(existingAsset._id.toString(), {
						quantity,
						price: existingAsset.price,
					});
				} else {
					const currentQuote = await tryGetQuote(assetCode);
					await this.portfolioService.addAssetToPortfolio(
						portfolio._id.toString(),
						{
							symbol: assetCode,
							quantity,
							price: currentQuote ?? 1,
							type: 'crypto',
						}
					);
				}
				syncedCount++;
			}

			connection.lastSync = new Date();
			connection.status = 'connected';
			connection.lastError = null;
			await connection.save();

			return {
				message: `Sincronização com ${provider} concluída.`,
				lastSync: connection.lastSync,
				syncedAssets: syncedCount,
			};
		} catch (error) {
			const reason =
				(error as any)?.response?.data?.msg ||
				(error as any)?.response?.data?.message ||
				(error as any)?.message ||
				'Erro desconhecido na sincronização';
			connection.status = 'error';
			connection.lastError = String(reason);
			await connection.save();
			throw new BadRequestException(`Erro na sincronização: ${reason}`);
		}
	}

	async disconnect(userId: string, provider: string) {
		const result = await BrokerConnectionModel.findOneAndDelete({
			userId: new Types.ObjectId(userId),
			provider,
		});

		if (!result) {
			throw new NotFoundException(`Conexão com ${provider} não encontrada.`);
		}

		return { message: `Conta ${provider} desconectada com sucesso.` };
	}
}
