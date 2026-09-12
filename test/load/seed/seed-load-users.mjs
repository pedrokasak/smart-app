#!/usr/bin/env node
/**
 * Semeador de usuarios de carga.
 *
 * POR QUE NAO USA A API. `POST /users/create` e publico e criaria os
 * usuarios, mas `UsersService.create` chama `sendWelcomeEmail` — semear 500
 * usuarios pela API dispara 500 e-mails reais pelo Resend, queima cota e
 * suja a reputacao do dominio. O seeder escreve direto no Mongo, com o mesmo
 * `PasswordSecurityService` (argon2id, mesmos parametros), para que o login
 * medido no cenario 1 custe exatamente o que custa em producao.
 *
 * DOMINIO DE E-MAIL. O default e `@loadtest.invalid`. `.invalid` e reservado
 * pela RFC 6761 e nunca resolve: mesmo que algum caminho tente enviar
 * e-mail para estes usuarios, a mensagem nao chega a lugar nenhum real.
 *
 * SENHA. Nao ha default. `LOAD_SEED_PASSWORD` e obrigatoria e nada e
 * versionado. Use a MESMA em `LOAD_USER_PASSWORD` ao rodar o k6.
 *
 * USO
 *   LOAD_SEED_PASSWORD='SenhaDeCarga123@' \
 *   DATABASE_URL='mongodb://...' \
 *   node test/load/seed/seed-load-users.mjs --count 50 --assets 15
 *
 *   # remover tudo o que este script criou:
 *   node test/load/seed/seed-load-users.mjs --purge
 *
 * O --purge apaga SOMENTE documentos cujo e-mail casa com o padrao de
 * carga. Ele nunca toca em usuario que nao tenha sido criado aqui.
 */

import mongoose from 'mongoose';
import * as argon2 from 'argon2';

function arg(name, fallback) {
	const i = process.argv.indexOf(`--${name}`);
	if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
	return fallback;
}

const flags = {
	count: Number(arg('count', process.env.LOAD_SEED_COUNT || 50)),
	assets: Number(arg('assets', process.env.LOAD_SEED_ASSETS || 15)),
	domain: arg('domain', process.env.LOAD_SEED_DOMAIN || 'loadtest.invalid'),
	prefix: arg('prefix', process.env.LOAD_SEED_PREFIX || 'loadtest+'),
	purge: process.argv.includes('--purge'),
	uri: process.env.DATABASE_URL,
};

if (!flags.uri) {
	console.error('\n  DATABASE_URL nao definida. Aponte para o Mongo alvo.\n');
	process.exit(1);
}

if (!flags.purge && !process.env.LOAD_SEED_PASSWORD) {
	console.error(
		'\n  LOAD_SEED_PASSWORD e obrigatoria.\n\n' +
			'  A senha precisa passar pelo mesmo criterio do CreateUserDto se voce\n' +
			'  quiser reutiliza-la em outros fluxos: 8+ caracteres, com maiuscula,\n' +
			'  minuscula, numero e caractere especial.\n\n' +
			'  Nao versione a senha. Use a mesma em LOAD_USER_PASSWORD no k6.\n'
	);
	process.exit(1);
}

/**
 * Mesmos parametros de `PasswordSecurityService`. Divergir aqui tornaria o
 * cenario 1 uma medicao de outra coisa.
 */
const ARGON2_OPTIONS = {
	type: argon2.argon2id,
	memoryCost: 64 * 1024,
	timeCost: 3,
	parallelism: 1,
	hashLength: 32,
};

const SYMBOLS = [
	'PETR4', 'VALE3', 'ITUB4', 'BBDC4', 'ABEV3', 'BBAS3', 'WEGE3',
	'MGLU3', 'B3SA3', 'RENT3', 'HGLG11', 'XPML11', 'MXRF11', 'KNRI11',
	'BTC', 'ETH', 'IVVB11', 'BOVA11', 'SUZB3', 'RADL3',
];

function emailFor(i) {
	return `${flags.prefix}${String(i).padStart(4, '0')}@${flags.domain}`;
}

/** Regex ancorada no padrao deste seeder — nunca casa usuario de verdade. */
function loadTestEmailRegex() {
	const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`^${esc(flags.prefix)}\\d+@${esc(flags.domain)}$`);
}

async function main() {
	await mongoose.connect(flags.uri);
	const db = mongoose.connection.db;
	const usersCol = db.collection('users');
	const portfoliosCol = db.collection('portfolios');
	const assetsCol = db.collection('assets');

	const pattern = loadTestEmailRegex();

	if (flags.purge) {
		const victims = await usersCol
			.find({ email: { $regex: pattern } }, { projection: { _id: 1 } })
			.toArray();
		const userIds = victims.map((u) => u._id);

		const portfolios = await portfoliosCol
			.find({ userId: { $in: userIds } }, { projection: { _id: 1 } })
			.toArray();
		const portfolioIds = portfolios.map((p) => p._id);

		const a = await assetsCol.deleteMany({ portfolioId: { $in: portfolioIds } });
		const p = await portfoliosCol.deleteMany({ userId: { $in: userIds } });
		const u = await usersCol.deleteMany({ email: { $regex: pattern } });

		console.log(
			`\n  removidos: ${u.deletedCount} usuario(s), ${p.deletedCount} carteira(s), ` +
				`${a.deletedCount} ativo(s)\n`
		);
		await mongoose.disconnect();
		return;
	}

	console.log(
		`\n  semeando ${flags.count} usuario(s) com ${flags.assets} ativo(s) cada\n` +
			`  padrao: ${emailFor(1)}\n`
	);

	// UM hash reaproveitado: todos os usuarios de carga compartilham a senha,
	// entao gerar 500 hashes argon2 (64 MiB cada) so faria o seeder demorar
	// minutos sem mudar o que o login vai custar depois.
	const hashed = await argon2.hash(process.env.LOAD_SEED_PASSWORD, ARGON2_OPTIONS);

	let created = 0;
	for (let i = 1; i <= flags.count; i += 1) {
		const email = emailFor(i);
		const now = new Date();

		const existing = await usersCol.findOne({ email }, { projection: { _id: 1 } });
		if (existing) {
			// Idempotente: reexecutar o seeder nao duplica nem reescreve senha.
			continue;
		}

		const { insertedId: userId } = await usersCol.insertOne({
			email,
			password: hashed,
			firstName: 'Load',
			lastName: `Test ${i}`,
			role: 'user',
			isActive: true,
			isEmailVerified: true,
			twoFactorEnabled: false,
			permissions: [],
			createdAt: now,
			updatedAt: now,
		});

		const { insertedId: portfolioId } = await portfoliosCol.insertOne({
			userId,
			name: `Carteira de carga ${i}`,
			ownerType: 'self',
			assets: [],
			totalValue: 0,
			plan: 'free',
			createdAt: now,
			updatedAt: now,
		});

		const assetDocs = [];
		let total = 0;
		for (let a = 0; a < flags.assets; a += 1) {
			const symbol = SYMBOLS[(i + a) % SYMBOLS.length];
			const quantity = 10 + ((i + a) % 90);
			const price = 10 + ((i * 7 + a * 13) % 200);
			total += quantity * price;
			assetDocs.push({
				portfolioId,
				symbol,
				name: symbol,
				type: symbol.endsWith('11') ? 'fii' : 'stock',
				quantity,
				price,
				avgPrice: price,
				total: quantity * price,
				source: 'manual',
				createdAt: now,
				updatedAt: now,
			});
		}

		const inserted = await assetsCol.insertMany(assetDocs);
		await portfoliosCol.updateOne(
			{ _id: portfolioId },
			{ $set: { assets: Object.values(inserted.insertedIds), totalValue: total } }
		);

		created += 1;
		if (created % 25 === 0) {
			process.stdout.write(`  criados ${created}/${flags.count}\r`);
		}
	}

	console.log(`\n  pronto: ${created} usuario(s) novo(s) (os demais ja existiam).\n`);
	console.log('  para rodar o k6 com eles:');
	console.log(
		`    k6 run -e LOAD_USER_PASSWORD='<a mesma senha>' ` +
			`-e LOAD_USER_COUNT=${flags.count} \\\n` +
			`        -e LOAD_USER_EMAIL_PATTERN='${flags.prefix}{i}@${flags.domain}' \\\n` +
			`        test/load/scenarios/01-auth.js\n`
	);

	await mongoose.disconnect();
}

main().catch((err) => {
	console.error(`\n  ERRO: ${err.message}\n`);
	process.exit(1);
});
