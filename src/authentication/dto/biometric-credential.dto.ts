import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsObject, IsString, Matches, ValidateNested } from 'class-validator';
import { SessionDeviceDto } from './session-device.dto';

export class EnrollBiometricCredentialDto {
	@IsObject()
	@ValidateNested()
	@Type(() => SessionDeviceDto)
	@ApiProperty({ type: SessionDeviceDto })
	device: SessionDeviceDto;
}

export class BiometricSigninDto extends EnrollBiometricCredentialDto {
	@ApiProperty({ description: 'Credencial recebida ao ligar a biometria' })
	@IsString()
	@Matches(/^[A-Za-z0-9_-]{43}$/)
	credential: string;
}

export class BiometricCredentialResponseDto {
	@ApiProperty({
		description: 'Mostrada só nesta resposta. O server guarda apenas o digest.',
	})
	credential: string;
}
