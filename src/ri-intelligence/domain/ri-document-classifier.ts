import { RiDocumentType } from 'src/ri-intelligence/domain/ri-document.types';

export const CANONICAL_RI_DOCUMENT_TYPES: RiDocumentType[] = [
	'earnings_release',
	'investor_presentation',
	'material_fact',
	'reference_form',
	'shareholder_notice',
	'financial_statement',
	'management_report',
	'conference_call_material',
	'dividend_notice',
	'other_ri_document',
	'unknown',
];

export interface ClassifyRiDocumentInput {
	title?: string | null;
	subtitle?: string | null;
	fileName?: string | null;
	url?: string | null;
	metadata?: Record<string, unknown> | null;
}

export interface ClassifiedRiDocumentType {
	documentType: RiDocumentType;
	confidence: 'high' | 'medium' | 'low';
	score: number;
	matchedAliases: string[];
}

interface Rule {
	type: Exclude<RiDocumentType, 'other_ri_document' | 'unknown'>;
	priority: number;
	aliases: string[];
}

const FIELD_WEIGHTS = {
	title: 1,
	subtitle: 0.8,
	fileName: 0.9,
	url: 0.7,
	metadata: 0.85,
} as const;

const CLASSIFICATION_RULES: Rule[] = [
	{
		type: 'material_fact',
		priority: 100,
		aliases: ['fato relevante', 'material fact', 'comunicado ao mercado'],
	},
	{
		type: 'earnings_release',
		priority: 90,
		aliases: [
			'release de resultados',
			'release resultados',
			'resultados do trimestre',
			'resultado do trimestre',
			'earnings release',
			'quarterly results',
			'press release',
		],
	},
	{
		type: 'investor_presentation',
		priority: 80,
		aliases: [
			'apresentacao de resultados',
			'apresentacao institucional',
			'investor presentation',
			'investor day presentation',
			'slide',
		],
	},
	{
		type: 'conference_call_material',
		priority: 75,
		aliases: [
			'conference call',
			'teleconferencia',
			'webcast',
			'call de resultados',
		],
	},
	{
		type: 'financial_statement',
		priority: 70,
		aliases: [
			'demonstracoes financeiras',
			'demonstracoes contabeis',
			'financial statements',
			'itr',
			'dfp',
			'balanco patrimonial',
		],
	},
	{
		type: 'management_report',
		priority: 65,
		aliases: [
			'relatorio da administracao',
			'management report',
			'relatorio de administracao',
		],
	},
	{
		type: 'reference_form',
		priority: 60,
		aliases: ['formulario de referencia', 'reference form', 'form referencia'],
	},
	{
		type: 'dividend_notice',
		priority: 55,
		aliases: ['dividendos', 'juros sobre capital proprio', 'jcp', 'proventos'],
	},
	{
		type: 'shareholder_notice',
		priority: 50,
		aliases: [
			'aviso aos acionistas',
			'assembleia geral',
			'edital de convocacao',
			'shareholder notice',
		],
	},
];

const TYPE_ALIASES: Record<string, RiDocumentType> = {
	earnings_release: 'earnings_release',
	release: 'earnings_release',
	release_resultados: 'earnings_release',
	investor_presentation: 'investor_presentation',
	presentation: 'investor_presentation',
	material_fact: 'material_fact',
	reference_form: 'reference_form',
	shareholder_notice: 'shareholder_notice',
	financial_statement: 'financial_statement',
	management_report: 'management_report',
	conference_call_material: 'conference_call_material',
	dividend_notice: 'dividend_notice',
	other_ri_document: 'other_ri_document',
	other: 'other_ri_document',
	unknown: 'unknown',
};

const GENERIC_RI_ALIASES = [
	'relacoes com investidores',
	'investor relations',
	'comunicado',
	'documento',
	'resultado',
	'mercado',
];

function normalize(value: unknown): string {
	return String(value || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[_\-/.]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function toFileName(urlOrName: string): string {
	const asPath = urlOrName.split('?')[0].split('#')[0];
	const chunks = asPath.split('/');
	return chunks[chunks.length - 1] || asPath;
}

function resolveFromMetadata(
	metadata?: Record<string, unknown> | null
): RiDocumentType | null {
	if (!metadata) return null;
	const candidateKeys = [
		'documentType',
		'type',
		'category',
		'kind',
		'docType',
		'classification',
	];
	for (const key of candidateKeys) {
		const normalized = normalize(metadata[key]);
		if (!normalized) continue;
		const direct = TYPE_ALIASES[normalized];
		if (direct) return direct;
	}
	return null;
}

export function normalizeRiDocumentType(rawType: unknown): RiDocumentType {
	const normalized = normalize(rawType);
	return TYPE_ALIASES[normalized] || 'unknown';
}

export function classifyRiDocumentType(
	input: ClassifyRiDocumentInput
): ClassifiedRiDocumentType {
	const title = normalize(input.title);
	const subtitle = normalize(input.subtitle);
	const url = normalize(input.url);
	const fileName = normalize(
		input.fileName || (input.url ? toFileName(String(input.url)) : '')
	);
	const metadataText = normalize(JSON.stringify(input.metadata || {}));

	const metadataType = resolveFromMetadata(input.metadata);
	if (metadataType && metadataType !== 'unknown') {
		return {
			documentType: metadataType,
			confidence: 'high',
			score: 0.98,
			matchedAliases: ['metadata_type_match'],
		};
	}

	const fields: Record<keyof typeof FIELD_WEIGHTS, string> = {
		title,
		subtitle,
		fileName,
		url,
		metadata: metadataText,
	};

	const ranking = CLASSIFICATION_RULES.map((rule) => {
		let score = 0;
		const matches = new Set<string>();
		for (const alias of rule.aliases) {
			const normalizedAlias = normalize(alias);
			for (const [fieldName, fieldValue] of Object.entries(fields)) {
				if (!fieldValue) continue;
				if (fieldValue.includes(normalizedAlias)) {
					score += FIELD_WEIGHTS[fieldName as keyof typeof FIELD_WEIGHTS];
					matches.add(alias);
				}
			}
		}
		return {
			type: rule.type,
			priority: rule.priority,
			score,
			matches: Array.from(matches),
		};
	})
		.filter((candidate) => candidate.score > 0)
		.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			return b.priority - a.priority;
		});

	if (!ranking.length) {
		const hasGenericRiSignal = GENERIC_RI_ALIASES.some((alias) =>
			`${title} ${subtitle} ${fileName} ${url}`.includes(normalize(alias))
		);
		if (hasGenericRiSignal) {
			return {
				documentType: 'other_ri_document',
				confidence: 'low',
				score: 0.35,
				matchedAliases: ['generic_ri_signal'],
			};
		}
		return {
			documentType: 'unknown',
			confidence: 'low',
			score: 0,
			matchedAliases: [],
		};
	}

	const winner = ranking[0];
	const normalizedScore = Math.min(1, Number((winner.score / 4).toFixed(3)));
	const confidence =
		normalizedScore >= 0.6 ? 'high' : normalizedScore >= 0.3 ? 'medium' : 'low';

	return {
		documentType: winner.type,
		confidence,
		score: normalizedScore,
		matchedAliases: winner.matches,
	};
}
