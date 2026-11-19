/**
 * Trava de dado pessoal nos chunks do RAG (ADR-002, TRA-16).
 *
 * O texto de um chunk sai do país para gerar o embedding (Gemini), então ele
 * só pode carregar ticker, datas, quantidades e valores. Os produtores já
 * montam o texto só com esses campos; esta função é a segunda barreira: se
 * alguém, por descuido, passar um campo livre (nome, e-mail, conta) para o
 * texto, o chunk é descartado em vez de seguir para o embedding.
 *
 * Os valores em reais saem formatados com ponto de milhar e vírgula
 * ("R$ 1.234.567"), que não casam com CPF (que exige hífen ou 11 dígitos
 * corridos) nem com CNPJ.
 */
const PERSONAL_DATA_PATTERNS: readonly RegExp[] = [
	/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/, // CPF formatado
	/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/, // CNPJ formatado
	/\b\d{11}\b/, // CPF sem máscara
	/\b\d{14}\b/, // CNPJ sem máscara
	/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, // e-mail
	/\b(ag[eê]ncia|conta|ag\.?|c\/c)\s*:?\s*\d{3,}/i, // agência e conta
];

export function containsPersonalData(text: string): boolean {
	return PERSONAL_DATA_PATTERNS.some((pattern) => pattern.test(text));
}
