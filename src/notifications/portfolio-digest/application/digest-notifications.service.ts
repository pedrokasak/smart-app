import { Injectable, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { toInAppNotificationItem } from 'src/notifications/events/application/in-app-notification.mapper';
import { PortfolioDigestFacts } from 'src/notifications/portfolio-digest/domain/portfolio-digest.types';
import {
	DigestNotificationItem,
	DigestNotificationsSummary,
	MAX_DIGEST_NOTIFICATIONS,
} from 'src/notifications/portfolio-digest/domain/digest-notification.types';
import { DigestNotificationsRepository } from 'src/notifications/portfolio-digest/infrastructure/digest-notifications.repository';

const EMPTY: DigestNotificationsSummary = { items: [], omitted: 0 };

/**
 * "O que avisamos nesta semana" (TRA-136, fase 7).
 *
 * O buraco que isto fecha: ate aqui, um usuario podia ser alertado na
 * terca de que a alocacao estourou a meta e receber, na segunda seguinte,
 * um digest que nao mencionava nada disso. Duas vozes descrevendo a mesma
 * carteira sem se falarem. Os dois sistemas continuam separados — o digest
 * NAO passa pelo `NotificationsService`, nao dispara evento, nao escreve
 * na colecao — mas agora compartilham informacao.
 *
 * Duas reutilizacoes deliberadas, ambas para nao criar segunda fonte da
 * verdade:
 *
 *   1. O PERIODO vem de `PortfolioDigestFacts` (`periodStart`/`periodEnd`,
 *      ja calculados pelo builder). Nao existe aqui uma segunda definicao
 *      de "semana": se o builder mudar a janela, esta secao acompanha
 *      sozinha.
 *   2. A COPY vem de `toInAppNotificationItem`, o mesmo mapper do centro
 *      in-app — que por sua vez renderiza `buildTemplate`. O e-mail semanal
 *      e a lista do app dizem literalmente a mesma frase sobre o mesmo
 *      evento, e corrigir um texto continua sendo mexer num lugar so.
 *
 * Nunca lanca: uma falha ao ler notificacoes devolve a secao vazia, e o
 * digest sai sem ela. O resumo de carteira nao pode deixar de ser enviado
 * por causa de uma secao acessoria.
 */
@Injectable()
export class DigestNotificationsService {
	private readonly logger = new Logger(DigestNotificationsService.name);

	constructor(private readonly repository: DigestNotificationsRepository) {}

	async collect(
		userId: string,
		facts: PortfolioDigestFacts
	): Promise<DigestNotificationsSummary> {
		const period = toPeriodRange(facts);
		if (!period) return EMPTY;

		let objectId: Types.ObjectId;
		try {
			objectId = new Types.ObjectId(userId);
		} catch {
			return EMPTY;
		}

		try {
			const docs = await this.repository.findInPeriod(
				objectId,
				period.start,
				period.end,
				MAX_DIGEST_NOTIFICATIONS
			);
			if (docs.length === 0) return EMPTY;

			const items = docs
				.map((doc) => this.toDigestItem(doc))
				.filter((item): item is DigestNotificationItem => item !== null);
			if (items.length === 0) return EMPTY;

			// So conta o total quando o teto foi de fato atingido — na semana
			// tipica esta consulta nem acontece.
			const total =
				docs.length < MAX_DIGEST_NOTIFICATIONS
					? docs.length
					: await this.repository.countInPeriod(
							objectId,
							period.start,
							period.end
						);

			return { items, omitted: Math.max(0, total - items.length) };
		} catch (error: any) {
			this.logger.warn(
				`Falha ao ler notificações da semana do usuário ${userId}: ${error?.message}; digest segue sem a seção.`
			);
			return EMPTY;
		}
	}

	/**
	 * `aiSummary` tem prioridade sobre o texto do template quando existe
	 * (mesma decisao da fase 5: o resumo da IA e uma camada A MAIS, e aqui
	 * ele e a forma mais curta de dizer a mesma coisa — o e-mail semanal e
	 * justamente onde a concisao importa). Sem `aiSummary`, o texto
	 * deterministico do template, que carrega os numeros exatos.
	 */
	private toDigestItem(doc: any): DigestNotificationItem | null {
		const item = toInAppNotificationItem(doc);
		const body = (item.aiSummary || item.body || '').trim();
		const title = (item.title || '').trim();
		if (!title && !body) return null;

		return {
			type: item.type,
			title: title || item.type,
			body,
			occurredAt: item.createdAt,
		};
	}
}

/**
 * `periodStart`/`periodEnd` sao datas locais 'YYYY-MM-DD' (ver
 * `PortfolioDigestBuilderService.toLocalIsoDate`). A janela e fechada nas
 * duas pontas: do primeiro instante do dia inicial ao ultimo do dia final,
 * no fuso local do processo — o mesmo em que as datas foram formatadas.
 */
function toPeriodRange(
	facts: PortfolioDigestFacts
): { start: Date; end: Date } | null {
	const start = parseLocalIsoDate(facts.periodStart, 0);
	const end = parseLocalIsoDate(facts.periodEnd, 1);
	if (!start || !end || start > end) return null;
	return { start, end };
}

function parseLocalIsoDate(value: string, dayOffset: number): Date | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
	if (!match) return null;

	const date = new Date(
		Number(match[1]),
		Number(match[2]) - 1,
		Number(match[3]) + dayOffset,
		0,
		0,
		0,
		0
	);
	if (!Number.isFinite(date.getTime())) return null;

	// Fim do periodo = ultimo milissegundo do dia final.
	return dayOffset === 0 ? date : new Date(date.getTime() - 1);
}
