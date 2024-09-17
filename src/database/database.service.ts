import { Injectable, OnModuleInit } from '@nestjs/common';

import mongoose from 'mongoose';

@Injectable()
export class ConnectDatabase implements OnModuleInit {
	async onModuleInit() {
		mongoose.connect(process.env.DATABASE_URL);

		mongoose.connection.on('error', (err) => {
			console.error('Erro na conexão do MongoDB:', err);
		});

		// Evento de reconexão
		mongoose.connection.on('reconnected', () => {
			console.log('Reconectado ao MongoDB');
		});
	}
}
