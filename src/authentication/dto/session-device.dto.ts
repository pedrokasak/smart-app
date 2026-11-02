import { ApiProperty } from '@nestjs/swagger';
import {
	IsIn,
	IsNotEmpty,
	IsString,
	Matches,
	MaxLength,
} from 'class-validator';

/** Aparelho do app mobile. O web não envia: a sessão vira plataforma `web`. */
export class SessionDeviceDto {
	@ApiProperty({ description: 'Identificador gerado pelo app na instalação' })
	@IsString()
	@Matches(/^[A-Za-z0-9_-]{8,64}$/)
	deviceId: string;

	@ApiProperty({ description: 'Nome exibido na lista de sessões' })
	@IsString()
	@IsNotEmpty()
	@MaxLength(80)
	deviceName: string;

	@ApiProperty({ enum: ['ios', 'android'] })
	@IsIn(['ios', 'android'])
	platform: 'ios' | 'android';
}
