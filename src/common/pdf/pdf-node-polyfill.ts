/**
 * Polyfill mínimo de globais de DOM para o pdf-parse (pdfjs) rodar em Node.
 *
 * O pdf-parse v2 é baseado no pdfjs-dist, que referencia `DOMMatrix`,
 * `ImageData` e `Path2D` no carregamento e durante o parse. Em Node esses
 * globais não existem, e sem eles ATÉ a extração de texto quebra com
 * "DOMMatrix is not defined" — verificado contra a v2.4.5 no Node 20.
 *
 * Só a renderização de imagem usa esses objetos de verdade; extração de
 * texto (o único uso aqui) nunca os invoca. Por isso stubs vazios bastam e
 * são seguros: destravam o load sem alterar o texto extraído.
 *
 * Importar ESTE módulo ANTES de `pdf-parse` — a ordem importa, os globais
 * precisam existir antes do módulo do pdfjs executar seu top-level.
 */
type Ctor = new (...args: unknown[]) => object;

const g = globalThis as Record<string, unknown>;

if (typeof g.DOMMatrix === 'undefined') {
	g.DOMMatrix = class DOMMatrix {} as unknown as Ctor;
}
if (typeof g.ImageData === 'undefined') {
	g.ImageData = class ImageData {} as unknown as Ctor;
}
if (typeof g.Path2D === 'undefined') {
	g.Path2D = class Path2D {} as unknown as Ctor;
}
