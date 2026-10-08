import { Inject, Injectable } from '@nestjs/common';
import axios from 'axios';
import { Readable } from 'stream';
import { CotahistSource } from '../application/ports';
import {
	DAILY_CLOSES_CONFIG,
	DailyClosesConfig,
} from '../application/daily-closes.config';
import { firstZipEntryStream } from './zip-first-entry';

const REQUEST_TIMEOUT_MS = 180_000;
/** O anual pesa dezenas de MB; o teto só barra resposta anormal. */
const MAX_ZIP_BYTES = 300 * 1024 * 1024;

/**
 * Linhas de um stream de texto. Não usa `readline`: ele não repassa o erro
 * do stream de entrada, e um deflate corrompido viraria `error` sem
 * listener (queda do processo). A iteração assíncrona do stream rejeita.
 */
export async function* linesOf(stream: Readable): AsyncGenerator<string> {
	let carry = '';
	for await (const chunk of stream) {
		const parts = (carry + chunk).split('\n');
		carry = parts.pop() ?? '';
		for (const line of parts) yield withoutCarriageReturn(line);
	}
	if (carry) yield withoutCarriageReturn(carry);
}

function withoutCarriageReturn(line: string): string {
	return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/** `AAAA-MM-DD` -> `DDMMAAAA`, como a B3 nomeia o arquivo do dia. */
export function dayStamp(date: string): string {
	const [year, month, day] = date.split('-');
	return `${day}${month}${year}`;
}

@Injectable()
export class B3CotahistSource implements CotahistSource {
	constructor(
		@Inject(DAILY_CLOSES_CONFIG) private readonly config: DailyClosesConfig
	) {}

	fetchDay(date: string) {
		return this.download(`COTAHIST_D${dayStamp(date)}.ZIP`);
	}

	fetchYear(year: number) {
		return this.download(`COTAHIST_A${year}.ZIP`);
	}

	private async download(
		fileName: string
	): Promise<AsyncIterable<string> | null> {
		const response = await axios.get<ArrayBuffer>(
			`${this.config.baseUrl}/${fileName}`,
			{
				responseType: 'arraybuffer',
				timeout: REQUEST_TIMEOUT_MS,
				maxContentLength: MAX_ZIP_BYTES,
				headers: { 'User-Agent': 'Trackerr/1.0 (+https://trackerr.com.br)' },
				// 404 é "não publicado" (feriado, fim de semana): não é falha.
				validateStatus: (status) => status === 200 || status === 404,
			}
		);
		if (response.status === 404) return null;

		// O axios já entrega Buffer em Node; copiar duplicaria o anual (dezenas de MB).
		const zip = Buffer.isBuffer(response.data)
			? response.data
			: Buffer.from(response.data);
		const entry = firstZipEntryStream(zip);
		// O arquivo é ISO-8859-1; os campos que usamos são todos ASCII.
		entry.setEncoding('latin1');
		return linesOf(entry);
	}
}
