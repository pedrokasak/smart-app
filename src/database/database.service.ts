import { Injectable, OnModuleInit } from '@nestjs/common';

import mongoose from 'mongoose';
import { resolveAutoIndex } from './mongo-index-policy';

@Injectable()
export class ConnectDatabase implements OnModuleInit {
	async onModuleInit() {
		// Conexão dos models estáticos (`model()` global): mesma política de
		// índice da conexão do Nest (TRA-204/TRA-214).
		mongoose.connect(process.env.DATABASE_URL, {
			autoIndex: resolveAutoIndex(),
		});

		mongoose.connection.on('error', (err) => {
			console.error('Erro na conexão do MongoDB:', err);
		});

		// Evento de reconexão
		mongoose.connection.on('reconnected', () => {
			console.log('Reconectado ao MongoDB');
		});
	}
}
