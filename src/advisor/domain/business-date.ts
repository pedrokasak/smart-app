/**
 * Fuso das datas do motor de atenção (R24): o escritório trabalha no horário
 * de Brasília, então "hoje" é a data local de São Paulo, não a do UTC. Datas
 * gravadas como chave (linha diária, `asOf`, `dataAsOf`) e as comparadas
 * (janela de vendas, adiamento, faixas do painel) saem daqui.
 */
export const BUSINESS_TIME_ZONE = 'America/Sao_Paulo';

const FORMAT = new Intl.DateTimeFormat('en-US', {
	timeZone: BUSINESS_TIME_ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
});

/** Data de negócio (YYYY-MM-DD) do instante `now` em São Paulo. */
export function businessDate(now: Date): string {
	const parts = FORMAT.formatToParts(now);
	const part = (type: Intl.DateTimeFormatPartTypes): string =>
		parts.find((p) => p.type === type)?.value ?? '';
	return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Soma `days` dias corridos a uma data YYYY-MM-DD (aritmética de calendário). */
export function addIsoDays(iso: string, days: number): string {
	const date = new Date(`${iso}T00:00:00.000Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}
