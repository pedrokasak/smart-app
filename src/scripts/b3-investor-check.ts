/**
 * Teste manual da integração com a Área do Investidor da B3 (TRA-185).
 *
 * Uso:
 *   bun tsx src/scripts/b3-investor-check.ts
 *   bun tsx src/scripts/b3-investor-check.ts 2026-10-27   # data de referência
 *
 * Requer as variáveis B3_INVESTOR_* apontando para o pacote de acesso
 * (ver `b3-investor.config.ts`). Sem B3_INVESTOR_ENV=production roda no
 * ambiente de certificação. Não sobe o AppModule nem precisa de banco.
 *
 * Passos: healthcheck (token + mTLS), investidores autorizados, API Guia e
 * posição/negociação do primeiro investidor autorizado. Documentos saem
 * mascarados no console.
 */
import 'dotenv/config';
import type { B3InvestorDataPort } from 'src/b3-investor/application/b3-investor-data.port';
import { B3InvestorError } from 'src/b3-investor/domain/b3-investor-error';
import { createB3InvestorData } from 'src/b3-investor/infrastructure/b3-investor-data.factory';
import { loadB3InvestorConfig } from 'src/b3-investor/infrastructure/b3-investor.config';

function mask(documentNumber: string): string {
	return documentNumber.length > 5
		? `${documentNumber.slice(0, 3)}***${documentNumber.slice(-2)}`
		: '***';
}

function yesterday(): string {
	const date = new Date(Date.now() - 24 * 60 * 60 * 1000);
	return date.toISOString().slice(0, 10);
}

async function step<T>(
	label: string,
	run: () => Promise<T>
): Promise<T | null> {
	try {
		const result = await run();
		console.log(`OK    ${label}`);
		return result;
	} catch (error) {
		const detail =
			error instanceof B3InvestorError
				? `${error.kind}${error.status ? ` (HTTP ${error.status})` : ''}: ${error.message}`
				: String((error as Error)?.message ?? error);
		console.log(`FALHA ${label}: ${detail}`);
		return null;
	}
}

async function main() {
	const referenceDate = process.argv[2] ?? yesterday();
	const configResult = loadB3InvestorConfig(process.env);
	if (configResult.status !== 'configured') {
		console.error(
			configResult.status === 'incomplete'
				? `Faltam variáveis: ${configResult.missing.join(', ')}`
				: 'Nenhuma variável B3_INVESTOR_* definida.'
		);
		process.exit(1);
	}
	console.log(
		`Ambiente: ${configResult.config.environment} (${configResult.config.baseUrl}), data de referência ${referenceDate}`
	);

	const b3: B3InvestorDataPort = createB3InvestorData(configResult, (reason) =>
		console.error(reason)
	);

	const healthy = await step('healthcheck (token + certificado)', () =>
		b3.healthcheck()
	);
	if (healthy === null) process.exit(1);

	const authorized = await step('investidores autorizados', () =>
		b3.listAuthorizedInvestors()
	);
	console.log(
		`      ${authorized?.length ?? 0} autorizados: ${(authorized ?? [])
			.slice(0, 5)
			.map((row) => mask(row.documentNumber))
			.join(', ')}`
	);

	const updated = await step('API Guia (EquitiesPosition)', () =>
		b3.listUpdatedInvestors('EquitiesPosition', {
			start: referenceDate,
			end: referenceDate,
		})
	);
	console.log(
		`      ${updated?.length ?? 0} com posição nova em ${referenceDate}`
	);

	const documentNumber = authorized?.[0]?.documentNumber ?? updated?.[0];
	if (!documentNumber) {
		console.log('Nenhum investidor para consultar posição.');
		return;
	}
	console.log(`Consultando ${mask(documentNumber)}`);

	const equities = await step('posição renda variável', () =>
		b3.getEquityPositions(documentNumber, referenceDate)
	);
	for (const row of (equities ?? []).slice(0, 10)) {
		console.log(
			`      ${row.ticker} qtd=${row.quantity} valor=${row.marketValue}`
		);
	}
	const treasury = await step('posição Tesouro Direto', () =>
		b3.getTreasuryBondPositions(documentNumber, referenceDate)
	);
	console.log(`      ${treasury?.length ?? 0} títulos`);
	const fixedIncome = await step('posição renda fixa', () =>
		b3.getFixedIncomePositions(documentNumber, referenceDate)
	);
	console.log(`      ${fixedIncome?.length ?? 0} ativos`);
	const trades = await step('negociações do mês', () =>
		b3.getAssetTrades(documentNumber, {
			start: `${referenceDate.slice(0, 8)}01`,
			end: referenceDate,
		})
	);
	console.log(`      ${trades?.length ?? 0} negócios`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
