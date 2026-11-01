import { canonicalize } from 'src/audit/domain/canonical-json';
import { sha256 } from 'src/audit/domain/audit-event';

/**
 * Bloco `provenance` que o trackerr-ia devolve em cada chamada ao LLM
 * (ADR-004, 9.2). Só ids e hashes: o texto do prompt, da carteira e da
 * resposta nunca chegam aqui.
 */
export interface GenerationProvenance {
	version: number;
	generation_id: string;
	kind: string;
	prompt: { id: string; version: string; sha256: string };
	model: {
		requested: string | null;
		served_provider: string | null;
		model: string | null;
	};
	inputs: Record<string, unknown>;
	checks: { guard: string; fallback_count: number };
	confidence: { min: number | null; max: number | null; basis: string } | null;
	output_sha256: string;
	subject_ids: string[];
}

/** O que o server grava: o bloco mais quem pediu (pseudônimo) e quando. */
export interface GenerationRecord {
	generationId: string;
	kind: string;
	/** HMAC do id do usuário. O vínculo com a pessoa fica fora do registro. */
	userRef: string;
	subjectIds: string[];
	prompt: GenerationProvenance['prompt'];
	model: GenerationProvenance['model'];
	inputs: Record<string, unknown>;
	checks: GenerationProvenance['checks'];
	confidence: GenerationProvenance['confidence'];
	outputSha256: string;
	recordedAt: Date;
	/** SHA-256 do registro acima, recalculável por quem o ler depois. */
	recordHash: string;
}

const isText = (value: unknown): value is string =>
	typeof value === 'string' && value.length > 0;

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Aceita só o que tem a forma mínima de um bloco. A resposta do trackerr-ia
 * é um dado externo: bloco malformado é descartado em vez de derrubar a
 * resposta que o usuário espera.
 */
export function parseProvenance(raw: unknown): GenerationProvenance[] {
	if (!Array.isArray(raw)) return [];
	return raw.filter((item): item is GenerationProvenance => {
		if (!isObject(item)) return false;
		const prompt = item.prompt;
		const model = item.model;
		const checks = item.checks;
		return (
			isText(item.generation_id) &&
			isText(item.kind) &&
			isObject(prompt) &&
			isText(prompt.id) &&
			isText(prompt.sha256) &&
			isObject(model) &&
			isObject(checks) &&
			isText(checks.guard) &&
			isText(item.output_sha256) &&
			isObject(item.inputs)
		);
	});
}

export function recordHashOf(
	record: Omit<GenerationRecord, 'recordHash'>
): string {
	return sha256(canonicalize(record));
}

export function buildGenerationRecord(
	provenance: GenerationProvenance,
	userRef: string,
	recordedAt: Date
): GenerationRecord {
	const record: Omit<GenerationRecord, 'recordHash'> = {
		generationId: provenance.generation_id,
		kind: provenance.kind,
		userRef,
		subjectIds: Array.isArray(provenance.subject_ids)
			? provenance.subject_ids.map(String)
			: [],
		prompt: provenance.prompt,
		model: provenance.model,
		inputs: provenance.inputs,
		checks: {
			guard: provenance.checks.guard,
			fallback_count: Number(provenance.checks.fallback_count) || 0,
		},
		confidence: provenance.confidence ?? null,
		outputSha256: provenance.output_sha256,
		recordedAt,
	};
	return { ...record, recordHash: recordHashOf(record) };
}
