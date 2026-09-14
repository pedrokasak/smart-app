import puppeteer from 'puppeteer';

/**
 * HTML → PDF A4 com o Chromium do puppeteer. Um navegador por chamada e
 * sempre fechado no `finally`: relatório é sob demanda e raro, e manter um
 * Chromium vivo custaria memória o tempo todo.
 */
export async function renderHtmlToPdf(html: string): Promise<Buffer> {
	const browser = await puppeteer.launch({
		headless: true,
		args: ['--no-sandbox', '--disable-setuid-sandbox'],
	});
	try {
		const page = await browser.newPage();
		// Conteúdo 100% inline: nenhuma requisição externa é necessária, e
		// bloquear evita que um dado importado com URL faça o servidor buscar algo.
		await page.setRequestInterception(true);
		page.on('request', (request) => {
			if (request.url().startsWith('data:')) request.continue();
			else request.abort();
		});
		await page.setContent(html, { waitUntil: 'load' });
		const pdf = await page.pdf({
			format: 'A4',
			printBackground: true,
			margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' },
		});
		return Buffer.from(pdf);
	} finally {
		await browser.close();
	}
}
