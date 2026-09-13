import {
	EVENT_PATTERN_MULTI_WILDCARD,
	EVENT_PATTERN_SINGLE_WILDCARD,
	EVENT_TYPE_SEPARATOR,
} from './domain-event';

/**
 * Casamento de padrao hierarquico do barramento (TRA-136).
 *
 * Existe em `domain/` de proposito. O adaptador in-process herda o
 * casamento do EventEmitter2, mas o worker da fila — e qualquer transporte
 * futuro que nao traga roteamento proprio — precisa da MESMA semantica.
 * Deixar a regra no dominio evita que "quem escuta o que" mude junto com o
 * transporte.
 *
 *   'portfolio.dividend.received'  casa exato
 *   'portfolio.*.received'         um nivel
 *   'portfolio.**'                 todos os niveis a partir dali
 *   '**'                           tudo
 */
export function matchesEventPattern(pattern: string, type: string): boolean {
	if (pattern === EVENT_PATTERN_MULTI_WILDCARD) return true;

	const segmentosPadrao = pattern.split(EVENT_TYPE_SEPARATOR);
	const segmentosTipo = type.split(EVENT_TYPE_SEPARATOR);

	for (let i = 0; i < segmentosPadrao.length; i++) {
		const segmento = segmentosPadrao[i];

		// '**' so faz sentido no fim: consome o resto do tipo.
		if (segmento === EVENT_PATTERN_MULTI_WILDCARD) {
			return i === segmentosPadrao.length - 1 && i < segmentosTipo.length;
		}

		if (i >= segmentosTipo.length) return false;
		if (segmento === EVENT_PATTERN_SINGLE_WILDCARD) continue;
		if (segmento !== segmentosTipo[i]) return false;
	}

	return segmentosPadrao.length === segmentosTipo.length;
}
