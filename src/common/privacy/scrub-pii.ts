/**
 * Minimização antes de mandar texto de usuário para fora (TRA-242, LGPD):
 * documentos, contatos e contas viram marcadores. Mesmos padrões do
 * trackerr-ia (`evals/pii.py`), que repete a limpeza do lado de lá.
 *
 * Nome próprio solto não é detectável com segurança e não é removido; por
 * isso a avaliação manda só pergunta e resposta, sem perfil nem `userId`.
 */
const PATTERNS: ReadonlyArray<[string, RegExp]> = [
	['[EMAIL]', /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g],
	['[CNPJ]', /(?<!\d)\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?!\d)/g],
	[
		'[CPF]',
		/(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)|(?<![\d.,])\d{11}(?![\d.,])/g,
	],
	['[CARTAO]', /(?<!\d)(?:\d{4}[ -]){3}\d{1,7}(?!\d)/g],
	[
		'[TELEFONE]',
		/(?:\+?55\s?)?\(\d{2}\)\s?9?\d{4}-?\d{4}(?!\d)|(?<!\d)\+55\s?\d{2}\s?9?\d{4}-?\d{4}(?!\d)|(?<![\d.,])\d{2}\s9\d{4}-\d{4}(?!\d)/g,
	],
	[
		'[CONTA]',
		/\b(ag[eê]ncia|conta(?:\s+corrente)?)\s*:?\s*(?:n[ºo°]\s*)?\d[\d.-]*/gi,
	],
];

export function scrubPii(text: string): string {
	let cleaned = String(text ?? '');
	for (const [placeholder, pattern] of PATTERNS) {
		cleaned = cleaned.replace(pattern, placeholder);
	}
	return cleaned;
}
