import {
	BadRequestException,
	Injectable,
	NotFoundException,
	Logger,
	ServiceUnavailableException,
} from '@nestjs/common';
import { BrokerConnectionModel } from './schema/broker-connection.model';
import { BrokerConnectDto } from './dto/broker-connect.dto';
import { Types } from 'mongoose';
import * as ccxt from 'ccxt';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { AssetsService } from 'src/assets/assets.service';
import { UserModel } from 'src/users/schema/user.model';
import { ProviderRegistry } from 'src/broker-sync/providers/provider-registry';
import { SubscriptionService } from 'src/subscription/subscription.service';
import { createBrokerCredentialCipher } from 'src/broker-sync/security/credential-cipher.factory';
import {
	BrokerCipherUnavailableError,
	BrokerCredentialCipher,
	BrokerCredentialDecryptionError,
} from 'src/broker-sync/security/broker-credential-cipher';
import {
	brokerSyncErrorMessage,
	isBrokerSyncErrorCategory,
} from 'src/broker-sync/domain/broker-sync-error';
import {
	brokerErrorLogLabel,
	classifyBrokerError,
} from 'src/broker-sync/providers/ccxt-error-classifier';

@Injectable()
export class BrokerSyncService {
	constructor(
		private readonly portfolioService: PortfolioService,
		private readonly assetsService: AssetsService,
		private readonly subscriptionService: SubscriptionService
	) {}

	private readonly logger = new Logger(BrokerSyncService.name);

	private readonly providerRegistry = new ProviderRegistry();

	/**
	 * Campo, e nao dependencia de construtor, pelo mesmo motivo do
	 * `providerRegistry` acima: a cifra nao tem dependencia de container e
	 * injeta-la exigiria mudar todos os call sites de teste do servico.
	 * A unidade em si (`AesGcmCredentialCipher`) recebe as chaves por
	 * construtor e e testada isolada, sem `process.env`.
	 */
	private readonly cipher: BrokerCredentialCipher =
		createBrokerCredentialCipher();
	private readonly fiatSymbols = new Set([
		'BRL',
		'USD',
		'USDT',
		'USDC',
		'EUR',
		'GBP',
		'JPY',
	]);

	private toPositiveNumber(value: unknown): number {
		if (typeof value === 'number') {
			return Number.isFinite(value) && value > 0 ? value : 0;
		}
		if (typeof value === 'string') {
			const parsed = Number(value.replace(',', '.').trim());
			return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
		}
		return 0;
	}

	private mergeBalanceBucket(
		target: Record<string, number>,
		bucket: Record<string, unknown> | undefined | null
	) {
		if (!bucket || typeof bucket !== 'object') return;
		for (const [symbol, rawValue] of Object.entries(bucket)) {
			const quantity = this.toPositiveNumber(rawValue);
			if (quantity <= 0) continue;
			target[symbol.toUpperCase()] =
				(target[symbol.toUpperCase()] || 0) + quantity;
		}
	}

	private extractPositiveBalances(balance: any): Record<string, number> {
		const out: Record<string, number> = {};
		this.mergeBalanceBucket(out, balance?.total as Record<string, unknown>);
		this.mergeBalanceBucket(out, balance?.free as Record<string, unknown>);
		this.mergeBalanceBucket(out, balance?.used as Record<string, unknown>);

		const infoBalances = Array.isArray(balance?.info?.balances)
			? balance.info.balances
			: [];
		for (const item of infoBalances) {
			const symbol = String(item?.asset || item?.currency || '').toUpperCase();
			if (!symbol) continue;
			const free = this.toPositiveNumber(item?.free);
			const locked = this.toPositiveNumber(item?.locked);
			const total = this.toPositiveNumber(item?.total);
			const quantity = total || free + locked;
			if (quantity <= 0) continue;
			out[symbol] = Math.max(out[symbol] || 0, quantity);
		}
		return out;
	}

	/**
	 * Adaptador fino sobre a porta de cifragem: traduz os erros de dominio da
	 * cifra em excecoes HTTP. Nenhuma logica de criptografia mora aqui.
	 *
	 * Falta de configuracao vira 503 (problema do servidor, e o operador tem a
	 * mensagem exata), nunca gravacao sob chave conhecida.
	 */
	private encrypt(text: string): string {
		try {
			return this.cipher.encrypt(text);
		} catch (error) {
			if (error instanceof BrokerCipherUnavailableError) {
				throw new ServiceUnavailableException(error.message);
			}
			throw error;
		}
	}

	/**
	 * Adulteracao, chave trocada ou valor legado sem chave antiga viram 400 com
	 * instrucao de reconectar — o usuario consegue agir. Nenhuma mensagem
	 * carrega o valor cifrado nem o valor em claro.
	 */
	private decrypt(text: string): string {
		try {
			return this.cipher.decrypt(text);
		} catch (error) {
			if (error instanceof BrokerCipherUnavailableError) {
				throw new ServiceUnavailableException(error.message);
			}
			if (error instanceof BrokerCredentialDecryptionError) {
				throw new BadRequestException(error.message);
			}
			throw error;
		}
	}

	async getConnections(userId: string) {
		const connections = await BrokerConnectionModel.find(
			{ userId: new Types.ObjectId(userId) },
			{ apiKeyEncrypted: 0, apiSecretEncrypted: 0 }
		);
		return connections.map((c) => {
			// Linha gravada ANTES da TRK-011 tem `lastError` com o texto cru da
			// corretora e nenhum `lastErrorCode`. Devolver esse texto é
			// exatamente o vazamento que esta issue fecha, então a ausência do
			// código é tratada como "não classificado" e a mensagem genérica
			// entra no lugar. Isso apaga a exposição das linhas antigas sem
			// precisar de migração — a próxima sincronização reescreve o par
			// com a categoria certa.
			const category = isBrokerSyncErrorCategory(c.lastErrorCode)
				? c.lastErrorCode
				: null;
			const hadError = !!category || !!c.lastError;

			return {
				id: c._id,
				provider: c.provider,
				status: c.status,
				lastSync: c.lastSync,
				hasCpf: !!c.cpf,
				// Contrato mantido: o `web` já lê `lastError` como string ou null.
				lastError: hadError
					? brokerSyncErrorMessage(category ?? 'unknown')
					: null,
				lastErrorCode: category,
				lastErrorStatus: c.lastErrorStatus ?? null,
			};
		});
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
			lastErrorCode: null,
			lastErrorStatus: null,
		};

		if (dto.apiKey) payload.apiKeyEncrypted = this.encrypt(dto.apiKey.trim());
		if (dto.apiSecret)
			payload.apiSecretEncrypted = this.encrypt(dto.apiSecret.trim());
		if (dto.apiPassphrase)
			payload.apiPassphraseEncrypted = this.encrypt(dto.apiPassphrase.trim());
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
		}).select('+apiKeyEncrypted +apiSecretEncrypted +apiPassphraseEncrypted');

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

		const apiKey = this.decrypt(connection.apiKeyEncrypted).trim();
		const secret = this.decrypt(connection.apiSecretEncrypted).trim();
		const password = connection.apiPassphraseEncrypted
			? this.decrypt(connection.apiPassphraseEncrypted).trim()
			: undefined;

		let exchange: ccxt.Exchange;
		try {
			exchange = providerImpl.createClient({ apiKey, secret, password });
		} catch (error) {
			// Mesma regra do catch da sincronização (TRK-011): é aqui que a
			// Private Key da Coinbase fora do PEM costuma estourar, e a
			// mensagem do `crypto` já chegou a ecoar material da chave.
			const sanitized = classifyBrokerError(error);
			this.logger.warn(
				`Falha ao instanciar cliente de ${provider}: ` +
					brokerErrorLogLabel(error, sanitized)
			);
			throw new BadRequestException(sanitized.message);
		}

		try {
			let totalBalances: Record<string, number> = {};

			if (provider === 'binance') {
				// Para Binance, tentamos consolidar Spot, Funding e Margin se possível
				const walletTypes = ['spot', 'funding', 'margin'];
				for (const type of walletTypes) {
					try {
						const bal = await exchange.fetchBalance({ type });
						const extracted = this.extractPositiveBalances(bal);
						for (const symbol of Object.keys(extracted)) {
							totalBalances[symbol] =
								(totalBalances[symbol] || 0) + extracted[symbol];
						}
					} catch (e) {
						this.logger.warn(
							`Erro ao buscar balance ${type} na Binance: ` +
								brokerErrorLogLabel(e, classifyBrokerError(e))
						);
					}
				}

				// Fallback: algumas contas/chaves não suportam "type" por wallet.
				// Nesse caso, tentamos o saldo padrão da exchange.
				if (Object.keys(totalBalances).length === 0) {
					try {
						const fallbackBalance = await exchange.fetchBalance();
						const extracted = this.extractPositiveBalances(fallbackBalance);
						for (const symbol of Object.keys(extracted)) {
							totalBalances[symbol] =
								(totalBalances[symbol] || 0) + extracted[symbol];
						}
					} catch (e) {
						this.logger.warn(
							`Erro no fallback fetchBalance() da Binance: ` +
								brokerErrorLogLabel(e, classifyBrokerError(e))
						);
					}
				}
			} else {
				const balance = await exchange.fetchBalance();
				totalBalances = this.extractPositiveBalances(balance);
			}

			const positiveAssets = Object.keys(totalBalances).filter(
				(symbol) =>
					totalBalances[symbol] > 0 &&
					!this.fiatSymbols.has(symbol.toUpperCase())
			);

			this.logger.log(
				`Sincronizando ${provider} para usuário ${userId}. Ativos encontrados com saldo: ${positiveAssets.length}. Exemplo: ${positiveAssets
					.slice(0, 10)
					.join(', ')}`
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
			const failedAssets: Array<{ symbol: string; reason: string }> = [];
			for (const symbol of positiveAssets) {
				try {
					const quantity = totalBalances[symbol];
					const assetCode = String(symbol || '')
						.trim()
						.toUpperCase();
					if (!assetCode || quantity <= 0) continue;

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
				} catch (assetError) {
					const reason = String((assetError as any)?.message || assetError);
					failedAssets.push({ symbol, reason });
					this.logger.warn(
						`Falha ao sincronizar ativo ${symbol} em ${provider}: ${reason}`
					);
				}
			}

			connection.lastSync = new Date();
			connection.status = 'connected';
			connection.lastError = null;
			connection.lastErrorCode = null;
			connection.lastErrorStatus = null;
			await connection.save();

			return {
				message: `Sincronização com ${provider} concluída.`,
				lastSync: connection.lastSync,
				syncedAssets: syncedCount,
				failedAssets: failedAssets.length,
				failedAssetsDetails: failedAssets.slice(0, 5),
			};
		} catch (error) {
			// TRK-011: o texto da corretora morre aqui. Algumas exchanges ecoam
			// a URL da requisição dentro da mensagem de erro, e a URL carrega a
			// API key — persistir isso colocava a credencial em claro no mesmo
			// banco onde ela está cifrada. O que sai daqui é categoria +
			// status, nada do provedor.
			const sanitized = classifyBrokerError(error);

			connection.status = 'error';
			connection.lastError = sanitized.message;
			connection.lastErrorCode = sanitized.category;
			connection.lastErrorStatus = sanitized.statusCode ?? null;
			await connection.save();

			// Log com tipo e status, sem a mensagem: log é mais um lugar onde
			// uma API key ecoada não deveria parar.
			this.logger.warn(
				`Falha ao sincronizar ${provider} para usuário ${userId}: ` +
					brokerErrorLogLabel(error, sanitized)
			);

			throw new BadRequestException(sanitized.message);
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
