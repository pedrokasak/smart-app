import { ERASED_USER_ID } from 'src/common/erased-user';

export { ERASED_USER_ID };

/**
 * Política de exclusão de conta (LGPD art. 18, VI), decidida no TRA-127.
 *
 * Toda coleção que guarda o id do titular cai em uma de três classes:
 *  - APAGAR: dado do titular, sem obrigação de guarda por parte do Trackerr.
 *    O app registra o que o usuário informa; não é corretora nem custodiante,
 *    então carteira, ativos, trades e histórico não são escrituração nossa.
 *  - ANONIMIZAR: registro de cobrança e trilha de auditoria. O Trackerr
 *    precisa guardá-los (obrigação fiscal sobre a receita e auditoria de
 *    ações administrativas — art. 16, I), mas sem ligação com a pessoa.
 *  - nada mais: o próprio `User` e o RAG são removidos pelo `UsersService`.
 *
 * Coleção nova com campo de dono precisa entrar aqui; o teste da política
 * falha enquanto ela não for classificada.
 */

export const ANONYMIZED_EMAIL = 'conta-excluida@anonimizado.invalid';

export interface ErasableCollection {
	model: string;
	ownerField: string;
}

/**
 * `Portfolio` é o último de propósito: `Asset` só se liga ao dono por ele, e
 * se a exclusão falhar no meio e for repetida, os ids das carteiras ainda
 * precisam existir para localizar os ativos.
 */
export const ERASABLE_COLLECTIONS: ReadonlyArray<ErasableCollection> = [
	{ model: 'BrokerConnection', ownerField: 'userId' },
	{ model: 'BrokerageNoteUpload', ownerField: 'userId' },
	{ model: 'Profile', ownerField: 'user' },
	{ model: 'InvestorProfile', ownerField: 'userId' },
	{ model: 'Address', ownerField: 'userId' },
	{ model: 'ChatMessage', ownerField: 'userId' },
	{ model: 'Notification', ownerField: 'user' },
	{ model: 'PushSubscription', ownerField: 'user' },
	{ model: 'ReportSchedule', ownerField: 'userId' },
	{ model: 'ThresholdState', ownerField: 'user' },
	{ model: 'FinancialPlan', ownerField: 'userId' },
	{ model: 'PortfolioTargetAllocation', ownerField: 'user' },
	{ model: 'Trade', ownerField: 'userId' },
	{ model: 'PortfolioHistory', ownerField: 'userId' },
	{ model: 'UpcomingDividend', ownerField: 'userId' },
	{ model: 'Portfolio', ownerField: 'userId' },
];

/** Apagado antes das carteiras: `Asset` não tem dono, só `portfolioId`. */
export const PORTFOLIO_OWNED_COLLECTION = {
	model: 'Asset',
	portfolioModel: 'Portfolio',
	portfolioOwnerField: 'userId',
	field: 'portfolioId',
} as const;

export interface RetainedCollection extends ErasableCollection {
	/** Campos pessoais substituídos por valor neutro. */
	scrub?: Readonly<Record<string, unknown>>;
	/** Campos que só servem para ligar o registro à pessoa. */
	unset?: ReadonlyArray<string>;
}

export const RETAINED_COLLECTIONS: ReadonlyArray<RetainedCollection> = [
	{
		model: 'UserSubscription',
		ownerField: 'user',
		unset: ['stripeCustomerId'],
	},
	{
		model: 'PixCharge',
		ownerField: 'user',
		unset: ['asaasCustomerId', 'qrCodePayload', 'qrCodeImage'],
	},
	{
		model: 'ManualGrantAudit',
		ownerField: 'user',
		scrub: { userEmail: ANONYMIZED_EMAIL },
	},
	{
		model: 'RoleChangeAudit',
		ownerField: 'user',
		scrub: { userEmail: ANONYMIZED_EMAIL },
	},
];
