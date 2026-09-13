import * as crypto from 'crypto';
import {
	hashRefreshToken,
	matchesRefreshTokenDigest,
} from 'src/authentication/security/refresh-token-hash';

/**
 * Codigos de recuperacao do 2FA.
 *
 * Hoje quem perde o autenticador perde a conta: nao existe caminho de
 * self-service, so suporte manual. Estes codigos sao o segundo fator
 * alternativo — dez valores aleatorios, mostrados uma unica vez, cada um
 * valido para exatamente um login.
 *
 * Este modulo e deliberadamente PURO, no mesmo espirito de
 * `two-factor-attempt-policy.ts`: gera, normaliza, hasheia e compara. Nao
 * conhece Mongoose, Nest nem HTTP, entao a regra inteira e testavel sozinha e
 * o service cuida apenas da persistencia.
 *
 * ## Por que SHA-256 e nao Argon2
 *
 * Um codigo daqui tem 40 bits de entropia vindos de `crypto.randomBytes` — nao
 * e um segredo escolhido por humano, entao um KDF de senha nao compra
 * resistencia a dicionario que ja nao exista. Pior: a verificacao precisa
 * percorrer a lista inteira, e Argon2id a 64 MiB por entrada custaria 640 MiB
 * por tentativa. Isso nao e seguranca, e um vetor de negacao de servico
 * acionavel por qualquer anonimo com o endpoint de consumo. Vale aqui o mesmo
 * raciocinio ja escrito em `refresh-token-hash.ts` para o refresh token, e por
 * isso este modulo reaproveita literalmente aquelas funcoes em vez de criar um
 * segundo primitivo de digest para manter em sincronia.
 *
 * Senhas continuam em Argon2id.
 */

/** Quantidade de codigos emitidos a cada geracao. */
export const RECOVERY_CODE_COUNT = 10;

/** Caracteres por codigo, sem contar o separador. */
export const RECOVERY_CODE_LENGTH = 8;

/** Onde o hifen entra na versao exibida (`A1B2-C3D4`). */
const RECOVERY_CODE_GROUP_SIZE = 4;

/**
 * Alfabeto de exatamente 32 simbolos, sem os pares que se confundem numa
 * captura de tela ou num papel: sem `I`/`1` e sem `O`/`0`. Sao 24 letras
 * (A-Z menos I e O) mais os digitos 2-9.
 *
 * O tamanho ser potencia de dois nao e detalhe estetico: com um alfabeto de
 * tamanho arbitrario, `byte % tamanho` distribui os primeiros simbolos com
 * probabilidade maior que os ultimos e o codigo perde entropia. Com 32,
 * `byte & 31` e uniforme e nao precisa de rejeicao.
 */
const RECOVERY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ALPHABET_MASK = 31;

/** Um codigo persistido. O consumo carimba `usedAt`, nunca remove a entrada. */
export interface StoredRecoveryCode {
	hash: string;
	usedAt: Date | null;
}

/** O que a rota de status devolve — nunca inclui hash nem codigo. */
export interface RecoveryCodesSummary {
	total: number;
	remaining: number;
	generatedAt: string | null;
}

/**
 * Fonte de aleatoriedade injetavel. Existe para o teste poder fixar a saida
 * sem monkey-patch em `crypto`; em producao e sempre `crypto.randomBytes`.
 */
export type RandomBytesFn = (size: number) => Buffer;

/**
 * Gera `count` codigos em texto puro, ja formatados para leitura.
 *
 * O alfabeto tem 32 simbolos, entao cada caractere carrega 5 bits e um codigo
 * de 8 caracteres carrega 40 — espaco grande o bastante para que adivinhar um
 * codigo especifico seja inviavel mesmo sem limite de tentativas, e o limite
 * existe assim mesmo.
 */
export function generateRecoveryCodes(
	count: number = RECOVERY_CODE_COUNT,
	randomBytes: RandomBytesFn = crypto.randomBytes
): string[] {
	const codes: string[] = [];

	for (let index = 0; index < count; index += 1) {
		codes.push(generateRecoveryCode(randomBytes));
	}

	return codes;
}

function generateRecoveryCode(randomBytes: RandomBytesFn): string {
	const bytes = randomBytes(RECOVERY_CODE_LENGTH);
	let raw = '';

	for (let index = 0; index < RECOVERY_CODE_LENGTH; index += 1) {
		raw += RECOVERY_CODE_ALPHABET[bytes[index] & ALPHABET_MASK];
	}

	return formatRecoveryCode(raw);
}

/** `A1B2C3D4` -> `A1B2-C3D4`. So aparencia: o hash e do valor normalizado. */
export function formatRecoveryCode(raw: string): string {
	const groups: string[] = [];

	for (let index = 0; index < raw.length; index += RECOVERY_CODE_GROUP_SIZE) {
		groups.push(raw.slice(index, index + RECOVERY_CODE_GROUP_SIZE));
	}

	return groups.join('-');
}

/**
 * Reduz o que o usuario digitou a forma canonica antes do hash.
 *
 * Quem usa isto esta copiando de uma captura de tela ou de um papel: vai
 * digitar minusculas, esquecer o hifen, colar com espaco no fim. Nada disso
 * deveria custar uma tentativa. Tudo que nao for letra ou digito e descartado,
 * e o resto sobe para maiuscula — a mesma normalizacao roda na geracao, entao
 * os dois lados sempre hasheiam exatamente o mesmo texto.
 */
export function normalizeRecoveryCode(raw: string): string {
	if (typeof raw !== 'string') {
		return '';
	}

	return raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

/** Digest SHA-256 (hex) da forma normalizada do codigo. */
export function hashRecoveryCode(code: string): string {
	return hashRefreshToken(normalizeRecoveryCode(code));
}

/** Converte os codigos em texto puro no formato que vai para o banco. */
export function toStoredRecoveryCodes(
	plaintextCodes: string[]
): StoredRecoveryCode[] {
	return plaintextCodes.map((code) => ({
		hash: hashRecoveryCode(code),
		usedAt: null,
	}));
}

/**
 * Devolve o hash da entrada ainda nao usada que casa com o codigo enviado, ou
 * `null`.
 *
 * Duas decisoes deliberadas:
 *
 * 1. A comparacao e `matchesRefreshTokenDigest`, que confere o comprimento e
 *    entao chama `crypto.timingSafeEqual`. Nunca `===` sobre os digests e
 *    nunca `Array.includes` sobre o valor cru — um `===` sobre string vaza,
 *    pelo tempo, quantos caracteres do digest ja batem, e isso e suficiente
 *    para reconstruir o alvo digito a digito.
 *
 * 2. O laco NAO sai no primeiro acerto. Sair cedo transformaria a posicao do
 *    codigo na lista em informacao observavel pelo tempo de resposta; percorrer
 *    sempre as dez entradas custa dez SHA-256, o que e ruido.
 */
export function findUsableRecoveryCodeHash(
	storedCodes: StoredRecoveryCode[],
	submittedCode: string
): string | null {
	const normalized = normalizeRecoveryCode(submittedCode);

	if (normalized.length === 0 || !Array.isArray(storedCodes)) {
		return null;
	}

	let match: string | null = null;

	for (const stored of storedCodes) {
		const isMatch = matchesRefreshTokenDigest(normalized, stored?.hash);

		if (isMatch && !stored?.usedAt && match === null) {
			match = stored.hash;
		}
	}

	return match;
}

/**
 * Resumo seguro para a rota de status. Recebe e devolve dados ja inertes:
 * contagens e um carimbo de tempo, nunca hash e nunca codigo.
 */
export function summarizeRecoveryCodes(
	storedCodes: StoredRecoveryCode[] | null | undefined,
	generatedAt: Date | null | undefined
): RecoveryCodesSummary {
	const codes = Array.isArray(storedCodes) ? storedCodes : [];

	return {
		total: codes.length,
		remaining: codes.filter((code) => !code?.usedAt).length,
		generatedAt: generatedAt ? new Date(generatedAt).toISOString() : null,
	};
}
