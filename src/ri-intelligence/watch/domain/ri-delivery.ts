import { classifyRiDocumentType } from 'src/ri-intelligence/domain/ri-document-classifier';
import { periodFromReference } from 'src/ri-intelligence/domain/ri-document-period';
import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';

/**
 * Uma entrega de documento na CVM como a consulta diaria do ENET lista
 * (TRA-260). E a fonte que torna o vigia de RI util para alerta: o dataset
 * IPE e semanal, a consulta do ENET mostra o documento no dia da entrega.
 */
export interface RiDelivery {
	/** Codigo CVM da companhia, normalizado (`normalizeCvmCode`). */
	cvmCode: string;
	company: string;
	category: string;
	type: string | null;
	subject: string | null;
	/** Data de referencia, ISO `AAAA-MM-DD`. */
	referenceDate: string | null;
	/** Dia da entrega, ISO `AAAA-MM-DD`. */
	deliveredOn: string;
	/** Protocolo de entrega: a identidade do documento em qualquer fonte da CVM. */
	protocol: string;
	downloadUrl: string;
	/** `false` quando a entrega foi cancelada ou substituida. */
	active: boolean;
}

/**
 * Converte a entrega no mesmo formato de registro que o adapter do IPE
 * produz, para o resto do vigia (relevancia, resumo, fila) nao distinguir a
 * fonte. O ENET nao tem o campo "Especie" do IPE, entao o titulo pode
 * diferir do IPE para o mesmo documento — por isso a identidade no vigia e
 * o protocolo, nunca o titulo.
 */
export function deliveryToRecord(
	delivery: RiDelivery,
	ticker: string
): RiDocumentRecord {
	const title = [delivery.category, delivery.type, delivery.subject]
		.map((part) => String(part ?? '').trim())
		.filter((part) => part && part !== '-')
		.join(' - ');
	const classified = classifyRiDocumentType({
		title,
		url: delivery.downloadUrl,
	});
	// Meia-noite UTC do dia da entrega: mesma convencao do `Data_Entrega` do
	// IPE, para as duas fontes produzirem o mesmo `publishedAt`.
	const publishedAt = `${delivery.deliveredOn}T00:00:00.000Z`;

	return {
		id: `${ticker}:${classified.documentType}:${publishedAt}:${delivery.protocol}:enet`,
		ticker,
		company: delivery.company,
		title,
		documentType: classified.documentType,
		period: periodFromReference(delivery.referenceDate, title),
		publishedAt,
		source: { type: 'url', value: delivery.downloadUrl },
		classification: {
			method: 'deterministic_rules',
			confidence: classified.confidence,
			score: classified.score,
			matchedAliases: classified.matchedAliases,
		},
		contentStatus: 'metadata_only',
		deliveryProtocol: delivery.protocol,
		cvmCategory: delivery.category || null,
		cvmType: delivery.type,
	};
}
