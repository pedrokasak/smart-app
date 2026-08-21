describe('pdf-node-polyfill (TRA-85)', () => {
	it('defines DOMMatrix, ImageData and Path2D globals for pdfjs in Node', () => {
		// Guarda de contrato: o pdf-parse (pdfjs) referencia estes globais no
		// load e no parse, e sem eles a extração de texto quebra em Node com
		// "DOMMatrix is not defined". Se este import for removido do adapter,
		// a extração volta a falhar em runtime — e o jest não consegue exercitar
		// o pdfjs (worker), então este teste é o que protege o polyfill.
		const g = globalThis as Record<string, unknown>;
		delete g.DOMMatrix;
		delete g.ImageData;
		delete g.Path2D;

		jest.isolateModules(() => {
			require('src/common/pdf/pdf-node-polyfill');
		});

		expect(typeof g.DOMMatrix).toBe('function');
		expect(typeof g.ImageData).toBe('function');
		expect(typeof g.Path2D).toBe('function');
		// Instanciável (pdfjs faz `new DOMMatrix()`).
		expect(() => new (g.DOMMatrix as new () => object)()).not.toThrow();
	});
});
