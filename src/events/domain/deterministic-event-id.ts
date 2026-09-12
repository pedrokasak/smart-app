import { createHash } from 'node:crypto';

/**
 * Namespace fixo do Trackerr para ids deterministicos de evento. Nao muda:
 * mudar re-emitiria como "novo" tudo que ja foi publicado.
 */
const TRACKERR_EVENT_NAMESPACE = '6f1a5c2e-8b7d-4f3a-9c21-0d5e8a4b7c60';

/**
 * Id de evento derivado do proprio fato (UUID v5), para produtores que
 * podem rodar de novo sobre o MESMO fato (TRA-136, fase 3).
 *
 * O caso concreto e o cron: o scan diario de assinaturas prestes a expirar
 * roda de novo em restart de dev, em redeploy, ou se alguem chamar o
 * metodo a mao. Com `id` aleatorio, a segunda passada seria um evento novo
 * — e o consumidor, que deduplica por `event.id`, mandaria a segunda
 * notificacao. Derivando o id dos componentes do fato ("este usuario, esta
 * assinatura, faltando 3 dias, vencendo neste dia"), a repeticao produz o
 * MESMO id e morre no dedupe da fila e do NotificationsService.
 *
 * Nao serve para fato que se repete de verdade: dois proventos iguais do
 * mesmo papel no mesmo dia sao dois fatos e precisam de dois ids. Por isso
 * o default do factory continua sendo `randomUUID`.
 */
export function deterministicEventId(...parts: (string | number)[]): string {
	const name = parts.map((p) => String(p)).join('|');
	const namespaceBytes = Buffer.from(
		TRACKERR_EVENT_NAMESPACE.replace(/-/g, ''),
		'hex'
	);

	const hash = createHash('sha1')
		.update(namespaceBytes)
		.update(Buffer.from(name, 'utf8'))
		.digest();

	const bytes = Buffer.from(hash.subarray(0, 16));
	// Versao 5 (nome + SHA-1) e variante RFC 4122, como manda o formato.
	bytes[6] = (bytes[6] & 0x0f) | 0x50;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;

	const hex = bytes.toString('hex');
	return [
		hex.slice(0, 8),
		hex.slice(8, 12),
		hex.slice(12, 16),
		hex.slice(16, 20),
		hex.slice(20, 32),
	].join('-');
}
