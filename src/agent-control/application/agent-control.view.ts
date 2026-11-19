import { ZodObject, ZodBoolean, ZodEnum, ZodNumber, ZodTypeAny } from 'zod';
import { AgentDefinition } from 'src/agent-control/domain/agent-definition';
import { AgentControlSnapshot } from 'src/agent-control/domain/agent-control.types';

/** Campo de configuração descrito para o painel montar o formulário. */
export type AgentConfigField =
	| { key: string; type: 'boolean' }
	| { key: string; type: 'enum'; options: { id: string; label: string }[] }
	| { key: string; type: 'number'; min: number | null; max: number | null };

/**
 * Lê o esquema estrito e descreve os campos. O painel não decide o que é
 * editável: só mostra o que o esquema aceita.
 */
export function describeConfigFields(
	definition: AgentDefinition
): AgentConfigField[] {
	const schema = definition.configSchema as unknown as ZodObject<
		Record<string, ZodTypeAny>
	>;
	if (!schema || !(schema instanceof ZodObject)) return [];

	return Object.entries(schema.shape).map(([key, field]) => {
		if (field instanceof ZodBoolean) return { key, type: 'boolean' };
		if (field instanceof ZodEnum) {
			const labels = new Map(
				(definition.scheduleOptions ?? []).map((option) => [
					option.id,
					option.label,
				])
			);
			return {
				key,
				type: 'enum',
				options: (field.options as string[]).map((id) => ({
					id,
					label: labels.get(id) ?? id,
				})),
			};
		}
		if (field instanceof ZodNumber) {
			return { key, type: 'number', min: field.minValue, max: field.maxValue };
		}
		return { key, type: 'boolean' };
	}) as AgentConfigField[];
}

function hhmm(date: Date): string {
	return date.toLocaleTimeString('pt-BR', {
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'America/Sao_Paulo',
	});
}

/**
 * Uma frase por mudança, para o histórico e o e-mail aos admins: o que
 * mudou, nunca o valor de um segredo (o esquema não aceita segredo).
 */
export function describeChange(
	before: AgentControlSnapshot,
	after: AgentControlSnapshot
): string {
	const parts: string[] = [];
	if (before.enabled !== after.enabled) {
		parts.push(after.enabled ? 'Desligado → Ligado' : 'Ligado → Desligado');
	}
	const pausedBefore = before.pausedUntil?.getTime() ?? null;
	const pausedAfter = after.pausedUntil?.getTime() ?? null;
	if (pausedBefore !== pausedAfter) {
		parts.push(
			after.pausedUntil
				? `Pausado até ${hhmm(after.pausedUntil)}`
				: 'Pausa encerrada'
		);
	}
	const keys = new Set([
		...Object.keys(before.config ?? {}),
		...Object.keys(after.config ?? {}),
	]);
	const configParts: string[] = [];
	for (const key of keys) {
		const from = before.config?.[key];
		const to = after.config?.[key];
		if (JSON.stringify(from) === JSON.stringify(to)) continue;
		configParts.push(
			typeof to === 'boolean'
				? `${key} ${to ? 'ligado' : 'desligado'}`
				: `${key} ${String(to)}`
		);
	}
	if (configParts.length) parts.push(`Configuração: ${configParts.join(', ')}`);
	return parts.join('; ');
}
