import {
	DOMAIN_EVENT_TYPES,
	DomainEventType,
} from 'src/events/domain/event-types';
import { THRESHOLD_RULE_IDS, ThresholdRuleId } from './threshold.types';

/**
 * Que evento passa por qual regra — e, principalmente, qual evento NAO
 * passa por regra nenhuma.
 *
 * O mapa e total sobre `DomainEventType` de proposito. Sem a exaustividade
 * o default silencioso decidiria por omissao: um evento novo cairia numa
 * das duas pontas por acidente. Aqui, adicionar um tipo de evento quebra o
 * typecheck ate alguem escrever se ele e continuo (tem regra) ou discreto
 * (passa direto).
 *
 * DISCRETOS. Provento recebido, assinatura expirando, cotacao parada e
 * insight de alta prioridade sao FATOS PONTUAIS, nao condicoes que ficam de
 * pe. Nao existe "borda de subida" de um dividendo: ele aconteceu uma vez.
 * Aplicar banda ou cooldown neles seria engolir notificacao legitima — dois
 * proventos do mesmo papel no mesmo mes sao dois avisos. A protecao contra
 * repeticao deles ja existe e e outra: o `event.id` deterministico do
 * produtor mais o dedupe do NotificationsService.
 */
export type ThresholdRouting =
	| { kind: 'rule'; ruleId: ThresholdRuleId }
	| { kind: 'discrete'; why: string };

export const THRESHOLD_ROUTING: Record<DomainEventType, ThresholdRouting> = {
	[DOMAIN_EVENT_TYPES.AllocationBreached]: {
		kind: 'rule',
		ruleId: THRESHOLD_RULE_IDS.AllocationDrift,
	},
	[DOMAIN_EVENT_TYPES.PortfolioScoreEvaluated]: {
		kind: 'rule',
		ruleId: THRESHOLD_RULE_IDS.PortfolioScoreDrop,
	},
	[DOMAIN_EVENT_TYPES.DividendReceived]: {
		kind: 'discrete',
		why: 'provento creditado e fato pontual — dois proventos sao dois avisos',
	},
	[DOMAIN_EVENT_TYPES.SubscriptionExpiring]: {
		kind: 'discrete',
		why: 'o cron ja emite so nas janelas de 7/3/1 dia, com id deterministico',
	},
	[DOMAIN_EVENT_TYPES.QuoteStale]: {
		kind: 'discrete',
		why: 'sem produtor hoje; quando existir, a janela e do proprio produtor',
	},
	[DOMAIN_EVENT_TYPES.AiInsightHighPriority]: {
		kind: 'discrete',
		why: 'insight e conteudo novo a cada rodada, nao uma condicao continua',
	},
};
