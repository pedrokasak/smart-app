/**
 * Descoberta usada pelo vigia de RI (TRA-240). Mesmo contrato do
 * `RiDocumentDiscoveryPort`, token proprio de proposito: a tela de RI usa a
 * cadeia resiliente (HTTP, CVM, FII e Puppeteer em sites de RI), mas uma
 * rotina automatica que roda sobre todos os tickers em carteira so pode bater
 * em fonte OFICIAL — o dataset IPE da CVM. Quem decide a fonte e o modulo.
 */
export const RI_WATCH_DISCOVERY = Symbol('RI_WATCH_DISCOVERY');
