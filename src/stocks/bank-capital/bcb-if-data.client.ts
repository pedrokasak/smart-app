const BASILEIA_CONTA = '79664';
const IMOBILIZACAO_CONTA = '79662';
/**
 * Teto por fetch. Exportado porque a caminhada de trimestres em
 * `BankCapitalService` faz aritmetica de orcamento em cima deste valor —
 * duplicar a constante la deixaria as duas silenciosamente divergentes.
 */
export const FETCH_TIMEOUT_MS = 8000;

export interface BcbQuarterValues {
	/**
	 * `true` quando o BCB respondeu e a resposta foi lida com sucesso — mesmo
	 * que o trimestre nao traga as contas procuradas (ausencia legitima de
	 * publicacao). `false` apenas para falha transitoria (rede, timeout,
	 * HTTP != 2xx, corpo ilegivel), em que os nulls NAO significam "sem dado".
	 *
	 * O contrato de "nunca lanca" continua valendo: o chamador fora deste
	 * modulo nunca ve excecao, so este flag.
	 */
	ok: boolean;
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
	timeoutMs: number = FETCH_TIMEOUT_MS
): Promise<BcbQuarterValues> {
	const failed: BcbQuarterValues = {
		ok: false,
		basileia: null,
		imobilizacao: null,
	};

	try {
		const response = await fetch(buildUrl(prudentialCode, anoMes), {
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (!response.ok) return failed;

		const body = await response.json();
		// Resposta OData sempre traz `value` como array (vazio quando o
		// trimestre nao publicou). Qualquer outra forma e corpo ilegivel, nao
		// ausencia de dado — tratar como transitorio para nao cachear 24h.
		if (!Array.isArray(body?.value)) return failed;
		const rows: Array<{ Conta?: string; Saldo?: number }> = body.value;

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
			ok: true,
			basileia: toPercent(seenContas.get(BASILEIA_CONTA) ?? null),
			imobilizacao: toPercent(seenContas.get(IMOBILIZACAO_CONTA) ?? null),
		};
	} catch {
		return failed;
	}
}
