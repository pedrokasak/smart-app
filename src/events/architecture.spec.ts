import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Guarda mecanica do criterio de aceite da TRA-136:
 *
 *   "Nenhum arquivo em src/**\/domain ou src/**\/application importa
 *    bullmq, ioredis ou @nestjs/event-emitter."
 *
 * O ponto nao e estetico. Se o dominio importar o transporte, trocar o
 * adaptador (in-process -> Kafka/NATS/HTTP) vira refactor de dominio, que e
 * exatamente o que esta issue existe para evitar. Um teste falha mais alto
 * que um comentario.
 *
 * Arquivos `.spec.ts` ficam de fora: teste de adaptador precisa importar o
 * adaptador, e teste nao vai para producao.
 */
const SRC = join(__dirname, '..');

const TRANSPORTES_PROIBIDOS = [
	'bullmq',
	'ioredis',
	'@nestjs/event-emitter',
	'@bull-board/api',
	'@bull-board/express',
];

/** Camadas que devem depender so de portas. */
const CAMADAS_PURAS = ['domain', 'application'];

function listarArquivosTs(dir: string): string[] {
	const saida: string[] = [];
	for (const entrada of readdirSync(dir)) {
		if (entrada === 'node_modules') continue;
		const caminho = join(dir, entrada);
		if (statSync(caminho).isDirectory()) {
			saida.push(...listarArquivosTs(caminho));
			continue;
		}
		if (entrada.endsWith('.ts') && !entrada.endsWith('.spec.ts')) {
			saida.push(caminho);
		}
	}
	return saida;
}

function emCamadaPura(caminho: string): boolean {
	const segmentos = relative(SRC, caminho).split(sep);
	return segmentos.some((s) => CAMADAS_PURAS.includes(s));
}

function importsDe(conteudo: string): string[] {
	const encontrados: string[] = [];
	const padrao = /(?:from\s+|import\s+|require\()\s*['"]([^'"]+)['"]/g;
	let match: RegExpExecArray | null;
	while ((match = padrao.exec(conteudo)) !== null) {
		encontrados.push(match[1]);
	}
	return encontrados;
}

describe('fronteira dominio x transporte (TRA-136)', () => {
	const arquivosPuros = listarArquivosTs(SRC).filter(emCamadaPura);

	it('encontra arquivos para inspecionar (o scanner nao esta vazio)', () => {
		expect(arquivosPuros.length).toBeGreaterThan(0);
	});

	it('nenhum arquivo de domain/ ou application/ importa o transporte', () => {
		const violacoes: string[] = [];

		for (const arquivo of arquivosPuros) {
			const imports = importsDe(readFileSync(arquivo, 'utf8'));
			for (const especificador of imports) {
				const proibido = TRANSPORTES_PROIBIDOS.find(
					(mod) => especificador === mod || especificador.startsWith(`${mod}/`)
				);
				if (proibido) {
					violacoes.push(`${relative(SRC, arquivo)} importa ${proibido}`);
				}
			}
		}

		expect(violacoes).toEqual([]);
	});

	it('o adaptador in-process e o unico ponto que conhece o EventEmitter2', () => {
		const donos = listarArquivosTs(join(SRC, 'events')).filter((arquivo) =>
			importsDe(readFileSync(arquivo, 'utf8')).some(
				(e) => e === '@nestjs/event-emitter'
			)
		);

		const relativos = donos
			.map((f) => relative(SRC, f).split(sep).join('/'))
			.sort();

		expect(relativos).toEqual([
			'events/events.module.ts',
			'events/infrastructure/in-process-event-bus.ts',
		]);
	});
});
