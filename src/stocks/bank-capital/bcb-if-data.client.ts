const BASILEIA_CONTA = '79664';
const IMOBILIZACAO_CONTA = '79662';
const FETCH_TIMEOUT_MS = 8000;

export interface BcbQuarterValues {
	basileia: number | null;
	imobilizacao: number | null;
}

function buildUrl(prudentialCode: string, anoMes: string): string {
	const base =
		'https://olinda.bcb.gov.br/olinda/servico/IFDATA/versao/v1/odata/IfDataValores';
	const params = `AnoMes=${anoMes},TipoInstituicao=1,Relatorio='5'`;
	const filter = encodeURIComponent(`CodInst eq '${prudentialCode}'`);
	return `${base}(${params})?$format=json&$filter=${filter}`;
}

export async function fetchQuarterValues(
	prudentialCode: string,
	anoMes: string,
): Promise<BcbQuarterValues> {
	const empty: BcbQuarterValues = { basileia: null, imobilizacao: null };

	try {
		const response = await fetch(buildUrl(prudentialCode, anoMes), {
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (!response.ok) return empty;

		const body = await response.json();
		const rows: Array<{ Conta?: string; Saldo?: number }> = Array.isArray(
			body?.value,
		)
			? body.value
			: [];

		const seenContas = new Map<string, number | null>();
		for (const row of rows) {
			const conta = String(row?.Conta || '');
			if (!conta || seenContas.has(conta)) continue;
			const saldo = typeof row?.Saldo === 'number' ? row.Saldo : null;
			seenContas.set(conta, saldo);
		}

		const toPercent = (value: number | null) =>
			value === null ? null : value * 100;

		return {
			basileia: toPercent(seenContas.get(BASILEIA_CONTA) ?? null),
			imobilizacao: toPercent(seenContas.get(IMOBILIZACAO_CONTA) ?? null),
		};
	} catch {
		return empty;
	}
}
