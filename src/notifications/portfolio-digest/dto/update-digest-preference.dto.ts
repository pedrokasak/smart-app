import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateDigestPreferenceDto {
	@ApiProperty({
		description: 'Ligar ou desligar o resumo semanal de carteira por e-mail.',
	})
	@IsBoolean()
	enabled: boolean;
}
