export interface AlertSettings {
	/** [P3, P2] em dias. */
	noContactDays: [number, number];
	/** [P1, P0] em %, janela de 5 pregões. */
	positionDropPct: [number, number];
	/** [P2, P1] em %. */
	portfolioDrawdownPct: [number, number];
	/** [P2, P1] em % da carteira. */
	concentrationPct: [number, number];
	/** [P3, P2] em pontos percentuais. */
	targetDriftPp: [number, number];
	/** P1, em % do patrimônio, janela de 30 dias. */
	largeSellsPct: number;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
	noContactDays: [90, 180],
	positionDropPct: [10, 20],
	portfolioDrawdownPct: [8, 15],
	concentrationPct: [25, 35],
	targetDriftPp: [5, 10],
	largeSellsPct: 20,
};

export const ALERT_SETTINGS_RANGES: Record<
	keyof AlertSettings,
	{ min: number; max: number }
> = {
	noContactDays: { min: 7, max: 730 },
	positionDropPct: { min: 1, max: 90 },
	portfolioDrawdownPct: { min: 1, max: 90 },
	concentrationPct: { min: 5, max: 100 },
	targetDriftPp: { min: 1, max: 100 },
	largeSellsPct: { min: 1, max: 100 },
};

export type AlertSettingsResult =
	| { ok: true; value: AlertSettings }
	| { ok: false; field: string };

const inRange = (field: keyof AlertSettings, n: unknown): n is number => {
	const { min, max } = ALERT_SETTINGS_RANGES[field];
	return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
};

function pair(
	field: Exclude<keyof AlertSettings, 'largeSellsPct'>,
	input: unknown
): [number, number] | null {
	if (input === undefined) return [...DEFAULT_ALERT_SETTINGS[field]];
	if (!Array.isArray(input) || input.length !== 2) return null;
	const [lighter, severe] = input as unknown[];
	if (!inRange(field, lighter) || !inRange(field, severe)) return null;
	if (severe <= lighter) return null;
	if (field === 'noContactDays') {
		if (!Number.isInteger(lighter) || !Number.isInteger(severe)) return null;
	}
	return [lighter, severe];
}

const PAIR_FIELDS = [
	'noContactDays',
	'positionDropPct',
	'portfolioDrawdownPct',
	'concentrationPct',
	'targetDriftPp',
] as const;

/** O conjunto inteiro: campo omitido volta ao padrão. */
export function validateAlertSettings(
	input: Partial<AlertSettings>
): AlertSettingsResult {
	const value: AlertSettings = {
		...DEFAULT_ALERT_SETTINGS,
	};
	for (const field of PAIR_FIELDS) {
		const checked = pair(field, input[field]);
		if (!checked) return { ok: false, field };
		value[field] = checked;
	}
	if (input.largeSellsPct !== undefined) {
		if (!inRange('largeSellsPct', input.largeSellsPct)) {
			return { ok: false, field: 'largeSellsPct' };
		}
		value.largeSellsPct = input.largeSellsPct;
	}
	return { ok: true, value };
}
