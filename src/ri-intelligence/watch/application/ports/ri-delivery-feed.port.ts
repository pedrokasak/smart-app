import { RiDelivery } from 'src/ri-intelligence/watch/domain/ri-delivery';

/**
 * Fonte diaria de entregas de documentos na CVM (TRA-260). Uma consulta
 * traz TODAS as companhias do periodo — o vigia filtra pelas que estao em
 * carteira. E a razao de existir desta porta ao lado da descoberta por
 * ticker: N tickers seriam N consultas a um sistema publico da CVM.
 *
 * Lanca quando a fonte nao responde como esperado (erro, sessao, captcha):
 * o vigia segue so com o IPE semanal naquela rodada.
 */
export interface RiDeliveryFeedPort {
	listDeliveries(from: Date, to: Date): Promise<RiDelivery[]>;
}

export const RI_DELIVERY_FEED = Symbol('RI_DELIVERY_FEED');
