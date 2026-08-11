import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class PurchaseIntentDto {
	@ApiProperty({
		description: 'E-mail do visitante interessado no plano',
		example: 'investidor@example.com',
	})
	@IsEmail({}, { message: 'Informe um e-mail válido' })
	email: string;

	@ApiProperty({
		description: 'Nome do plano que gerou o interesse',
		example: 'Premium',
	})
	@IsString()
	@IsNotEmpty({ message: 'O nome do plano é obrigatório' })
	planName: string;
}
