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
 *  - pelo módulo dono: coleções com regra própria (MODULE_ERASED_COLLECTIONS).
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
	{ model: 'ChatConversation', ownerField: 'userId' },
	{ model: 'VoiceConsent', ownerField: 'userId' },
	{ model: 'VoiceUsage', ownerField: 'userId' },
	{ model: 'Notification', ownerField: 'user' },
	{ model: 'PushSubscription', ownerField: 'user' },
	{ model: 'UserSession', ownerField: 'user' },
	{ model: 'BiometricCredential', ownerField: 'user' },
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

/**
 * Coleções cuja exclusão o módulo dono executa, pelo próprio serviço, porque
 * a regra não cabe num `deleteMany` por dono: o Trackerr Advisor encerra os
 * acessos (e audita) antes de apagar, acha os convites pelas relações dos
 * consentimentos do usuário e pelo e-mail da conta e só desliga o perfil do cliente, que é registro da organização. Tudo isso é
 * `ConsentService.eraseUser`, chamado antes de qualquer outra remoção.
 *
 * Equipe do escritório (`TeamService.eraseUser`, logo depois): vínculo,
 * atribuições e convites de membro pendentes (pelo e-mail normalizado) são
 * dado do titular; a liberação do portal (`AdvisorPortalGrant`) também, e
 * apagá-la fecha o escritório de um dono excluído que só tinha acesso por
 * liberação do admin (E6).
 */
export interface ModuleErasedCollection extends ErasableCollection {
	effect: 'delete' | 'anonymize';
}

export const MODULE_ERASED_COLLECTIONS: ReadonlyArray<ModuleErasedCollection> =
	[
		{ model: 'AdvisorConsent', ownerField: 'userId', effect: 'delete' },
		{ model: 'AdvisorClientInvite', ownerField: 'email', effect: 'delete' },
		{
			model: 'AdvisorClientProfile',
			ownerField: 'ownerUserId',
			effect: 'anonymize',
		},
		{ model: 'AdvisorMembership', ownerField: 'userId', effect: 'delete' },
		{
			model: 'AdvisorClientAssignment',
			ownerField: 'userId',
			effect: 'delete',
		},
		{ model: 'AdvisorMemberInvite', ownerField: 'email', effect: 'delete' },
		{ model: 'AdvisorPortalGrant', ownerField: 'userId', effect: 'delete' },
		// Read model do motor de atenção (P3b). Dado do cliente da organização,
		// sem id do titular: o módulo apaga por cliente (`delete`, `deleteClient`,
		// `deleteByClient`) quando o vínculo acaba ou a conta é excluída.
		{
			model: 'AdvisorClientSnapshot',
			ownerField: 'clientProfileId',
			effect: 'delete',
		},
		{
			model: 'AdvisorWealthDaily',
			ownerField: 'clientProfileId',
			effect: 'delete',
		},
		{ model: 'AdvisorAlert', ownerField: 'clientProfileId', effect: 'delete' },
		{
			model: 'AdvisorClientContact',
			ownerField: 'clientProfileId',
			effect: 'delete',
		},
		// `AdvisorAlertSettings` é da organização (limites e data de ligação do
		// motor) e não guarda dado de cliente: entra só para ficar classificada.
		// Nada a apagar por cliente; segue o ciclo de vida da organização.
		{ model: 'AdvisorAlertSettings', ownerField: 'orgId', effect: 'delete' },
	];

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
