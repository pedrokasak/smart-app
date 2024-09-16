import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';

@Controller()
export class KafkaController {
	@EventPattern('portfolio-sync') // Nome do tópico
	async handlePortfolioSync(@Payload() message) {
		console.log('Received message:', message);
		// Aqui você processa a sincronização da carteira
	}
}
