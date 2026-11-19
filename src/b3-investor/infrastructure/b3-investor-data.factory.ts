import type { B3InvestorDataPort } from 'src/b3-investor/application/b3-investor-data.port';
import { B3InvestorError } from 'src/b3-investor/domain/b3-investor-error';
import { B3AccessTokenProvider } from './b3-access-token.provider';
import type { B3InvestorConfigResult } from './b3-investor.config';
import {
	createMutualTlsTransport,
	createTokenTransport,
} from './b3-http.transport';
import { HttpB3InvestorDataAdapter } from './http-b3-investor-data.adapter';

function notConfigured(reason: string): B3InvestorDataPort {
	const fail = async (): Promise<never> => {
		throw new B3InvestorError('not_configured', reason);
	};
	return {
		healthcheck: fail,
		listAuthorizedInvestors: fail,
		listUpdatedInvestors: fail,
		getEquityPositions: fail,
		getTreasuryBondPositions: fail,
		getFixedIncomePositions: fail,
		getEquityMovements: fail,
		getAssetTrades: fail,
	};
}

/**
 * Monta o adapter real quando a configuração está completa. Sem ela, ou
 * com certificado ilegível, devolve um adapter que falha com
 * `not_configured` em vez de derrubar o boot: a integração é opcional e
 * começa desligada em todos os ambientes. `warn` recebe o motivo quando a
 * configuração existe mas não pôde ser usada.
 */
export function createB3InvestorData(
	result: B3InvestorConfigResult,
	warn: (message: string) => void = () => undefined
): B3InvestorDataPort {
	if (result.status === 'disabled') {
		return notConfigured(
			'Integração B3 desligada: variáveis B3_INVESTOR_* ausentes'
		);
	}
	if (result.status === 'incomplete') {
		const reason = `Integração B3 incompleta: faltam ${result.missing.join(', ')}`;
		warn(reason);
		return notConfigured(reason);
	}

	const { config } = result;
	let apiTransport;
	try {
		apiTransport = createMutualTlsTransport(config);
	} catch (error) {
		const reason = `Certificado da B3 ilegível: ${(error as Error)?.message ?? error}`;
		warn(reason);
		return notConfigured(reason);
	}
	const tokens = new B3AccessTokenProvider(
		createTokenTransport(config),
		config
	);
	return new HttpB3InvestorDataAdapter(apiTransport, tokens, config.baseUrl);
}
