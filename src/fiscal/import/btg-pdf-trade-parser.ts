import { Trade } from 'src/fiscal/domain/trade';

const parseNumberPtBr = (v: string) => {
	const s = (v ?? '')
		.toString()
		.trim()
		.replace(/\./g, '')
		.replace(',', '.');
	const n = Number(s);
	return Number.isFinite(n) ? n : NaN;
};

const parseBtgTradingDate = (text: string): Date | null => {
	// Example: "19/02/2026" near "Data pregão"
	const m = text.match(/(\d{2}\/\d{2}\/\d{4})/);
	if (!m) return null;
	const [dd, mm, yyyy] = m[1].split('/');
	const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
	return Number.isNaN(d.getTime()) ? null : d;
};

const normalizeSymbol = (raw: string) => {
	// BTG sometimes shows fractional tickers with trailing "F" (e.g. BBDC4F, RAIZ4F, VBBR3F)
	const s = (raw ?? '').toString().trim().toUpperCase();
	return s.endsWith('F') ? s.slice(0, -1) : s;
};

export function parseTradesFromBtgPdfText(pdfText: string): Trade[] {
	if (!pdfText) return [];

	const tradingDate =
		parseBtgTradingDate(
			// Try to bias match around header
			pdfText.split('Negócios realizados')[0] || pdfText
		) || parseBtgTradingDate(pdfText);

	if (!tradingDate) return [];

	const lines = pdfText
		.split(/\r?\n/)
		.map((l) => l.replace(/\s+/g, ' ').trim())
		.filter(Boolean);

	// Find section start
	const startIdx = lines.findIndex((l) =>
		l.toLowerCase().includes('negócios realizados')
	);
	if (startIdx === -1) return [];

	const trades: Trade[] = [];

	for (let i = startIdx; i < lines.length; i++) {
		const line = lines[i];

		// Stop at summary
		if (line.toLowerCase().includes('resumo dos negócios')) break;

		// Skip header line
		if (line.toLowerCase().startsWith('q negociação')) continue;

		// Example line (text-extracted):
		// "1-BOVESPA C VISTA BBDC4F PN 1 21,25 21,25 D"
		const m = line.match(
			/^\d+-BOVESPA\s+([CV])\s+VISTA\s+([A-Z0-9]{3,15})\s+.*?\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s+[DC]\b/i
		);

		if (!m) continue;

		const side = m[1].toUpperCase() === 'C' ? 'buy' : 'sell';
		const symbol = normalizeSymbol(m[2]);
		const quantity = parseNumberPtBr(m[3]);
		const price = parseNumberPtBr(m[4]);

		if (!symbol) continue;
		if (!Number.isFinite(quantity) || quantity <= 0) continue;
		if (!Number.isFinite(price) || price < 0) continue;

		trades.push({
			assetSymbol: symbol,
			side,
			quantity,
			price,
			fees: 0,
			date: tradingDate,
		});
	}

	return trades;
}

