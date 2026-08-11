import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn } from 'class-validator';

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
	@IsIn(['Premium', 'Global Investor'], { message: 'Plano inválido' })
	planName: string;
}
