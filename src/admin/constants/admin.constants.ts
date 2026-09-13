export const INITIAL_ADMIN_EMAIL = 'pedrohesm@gmail.com';

export enum ManualGrantType {
	Trial = 'TRIAL',
	Permanent = 'PERMANENT',
}

// Mantido para compatibilidade com registros de auditoria antigos, que
// persistiram o grantType fixo 'TRIAL_7_DAYS' antes da duração customizável
// (TRA-116). Não usar em código novo.
export const LEGACY_TRIAL_7_DAYS_GRANT_TYPE = 'TRIAL_7_DAYS';

export const MIN_TRIAL_DURATION_DAYS = 1;
export const MAX_TRIAL_DURATION_DAYS = 365;
export const MIN_DISCOUNT_PERCENT = 0;
export const MAX_DISCOUNT_PERCENT = 100;
