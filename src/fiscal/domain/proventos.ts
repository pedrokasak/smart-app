/**
 * Proventos do ano por ativo, separados pelo tipo gravado no lançamento.
 *
 * O relatório de IR somava tudo (JCP incluído) no total de dividendos, que
 * vai para "Rendimentos Isentos", e deixava o JCP fixo em zero. JCP não é
 * isento: tem 15% retidos na fonte e vai para "Rendimentos Sujeitos à
 * Tributação Exclusiva". Apresentá-lo como dividendo faz o usuário declarar
 * o valor na ficha errada.
 *
 * Só o JCP sai do total de dividendos. `DIVIDEND`, `RENDIMENTO` (FII) e
 * `OTHER`, ou lançamento sem tipo, ficam onde estavam; separar o rendimento de
 * FII é assunto do guia ficha por ficha.
 */
export interface ProventoEvent {
	date?: Date | string | null;
	value?: number | null;
	paymentType?: string | null;
}

export interface ProventoAsset {
	symbol?: string | null;
	dividendHistory?: ProventoEvent[] | null;
}

export interface ProventoTotal {
	symbol: string;
	total: number;
}

export interface ProventosOfYear {
	dividends: ProventoTotal[];
	jcp: ProventoTotal[];
}

const round2 = (value: number) =>
	Math.round((value + Number.EPSILON) * 100) / 100;

export function splitProventosByType(
	assets: ProventoAsset[],
	year: number
): ProventosOfYear {
	const dividends = new Map<string, number>();
	const jcp = new Map<string, number>();

	for (const asset of assets || []) {
		const symbol = String(asset?.symbol || '').toUpperCase();
		const events = Array.isArray(asset?.dividendHistory)
			? asset.dividendHistory
			: [];
		if (!symbol) continue;

		for (const event of events) {
			const date = event?.date ? new Date(event.date) : null;
			const value = Number(event?.value);
			if (!date || Number.isNaN(date.getTime())) continue;
			if (date.getUTCFullYear() !== year) continue;
			if (!Number.isFinite(value) || value <= 0) continue;

			const bucket = event.paymentType === 'JCP' ? jcp : dividends;
			bucket.set(symbol, (bucket.get(symbol) ?? 0) + value);
		}
	}

	const toList = (map: Map<string, number>): ProventoTotal[] =>
		Array.from(map.entries())
			.map(([symbol, total]) => ({ symbol, total: round2(total) }))
			.sort((a, b) => a.symbol.localeCompare(b.symbol));

	return { dividends: toList(dividends), jcp: toList(jcp) };
}
