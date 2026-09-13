import { SharedArray } from 'k6/data';

/**
 * Origem das credenciais de teste (harness de carga).
 *
 * NENHUMA credencial e versionada aqui. O harness precisa de usuarios para
 * logar, e ha exatamente duas formas de fornece-los — as duas por variavel
 * de ambiente:
 *
 *   1. LOAD_USERS_FILE=/caminho/users.json
 *      Arquivo JSON com [{ "email": "...", "password": "..." }, ...].
 *      Use isto para apontar o harness para um dataset ja semeado
 *      (staging, por exemplo). O arquivo fica FORA do repo.
 *
 *   2. LOAD_USER_PASSWORD=... [+ LOAD_USER_COUNT, LOAD_USER_EMAIL_PATTERN]
 *      Deriva a lista do padrao de e-mail usado pelo seeder
 *      (test/load/seed/seed-load-users.mjs), que cria todos os usuarios com
 *      a MESMA senha. E o caminho normal para o ambiente local.
 *
 * Sem nenhuma das duas o run aborta no init, com instrucao. Um default
 * embutido aqui seria uma credencial versionada com outro nome.
 */

const DEFAULT_EMAIL_PATTERN = 'loadtest+{i}@loadtest.invalid';
const DEFAULT_USER_COUNT = 50;

function fromFile(path) {
	const raw = open(path);
	const parsed = JSON.parse(raw);
	if (!Array.isArray(parsed) || parsed.length === 0) {
		throw new Error(`LOAD_USERS_FILE=${path} nao contem um array de usuarios`);
	}
	parsed.forEach((u, i) => {
		if (!u || !u.email || !u.password) {
			throw new Error(
				`LOAD_USERS_FILE=${path}: item ${i} sem 'email' ou 'password'`
			);
		}
	});
	return parsed;
}

function fromPattern() {
	const password = __ENV.LOAD_USER_PASSWORD;
	if (!password) {
		throw new Error(
			'\n\n  SEM CREDENCIAIS DE TESTE.\n\n' +
				'  Forneca uma das duas:\n' +
				'    -e LOAD_USERS_FILE=/caminho/users.json      (dataset ja semeado)\n' +
				'    -e LOAD_USER_PASSWORD=...                   (usuarios do seeder)\n\n' +
				'  Para semear localmente:\n' +
				'    LOAD_SEED_PASSWORD=... node test/load/seed/seed-load-users.mjs\n\n' +
				'  Ver test/load/README.md, secao "Dados de teste".\n'
		);
	}

	const count = Number(__ENV.LOAD_USER_COUNT || DEFAULT_USER_COUNT);
	const pattern = __ENV.LOAD_USER_EMAIL_PATTERN || DEFAULT_EMAIL_PATTERN;
	const users = [];
	for (let i = 1; i <= count; i += 1) {
		users.push({
			email: pattern.replace('{i}', String(i).padStart(4, '0')),
			password,
		});
	}
	return users;
}

/**
 * SharedArray: a lista e carregada uma vez e compartilhada por todos os VUs.
 * Com 500 VUs, uma copia por VU custaria memoria a toa na maquina de carga
 * — e memoria na maquina de carga vira latencia falsa no resultado.
 */
export const users = new SharedArray('load-test-users', () =>
	__ENV.LOAD_USERS_FILE ? fromFile(__ENV.LOAD_USERS_FILE) : fromPattern()
);

/** Distribui usuarios entre VUs/iteracoes sem que dois VUs colidam sempre. */
export function pickUser(vuId, iteration) {
	return users[(vuId + iteration) % users.length];
}
