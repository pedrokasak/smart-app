import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
	IsBoolean,
	IsNotEmpty,
	IsObject,
	IsOptional,
	IsString,
	MaxLength,
	MinLength,
	ValidateNested,
} from 'class-validator';
import { SessionDeviceDto } from './session-device.dto';

export class AppleSigninDto {
	@ApiProperty({ description: 'identityToken devolvido pela Apple' })
	@IsString()
	@IsNotEmpty()
	@MinLength(40)
	@MaxLength(4000)
	identityToken: string;

	@ApiProperty({
		description: 'Nonce enviado à Apple, quando o app usar um',
		required: false,
	})
	@IsOptional()
	@IsString()
	@MaxLength(256)
	nonce?: string;

	@ApiProperty({
		description: 'A Apple só entrega o nome ao app no primeiro login',
		required: false,
	})
	@IsOptional()
	@IsString()
	@MaxLength(100)
	firstName?: string;

	@ApiProperty({ required: false })
	@IsOptional()
	@IsString()
	@MaxLength(100)
	lastName?: string;

	@ApiProperty({ required: false, default: false })
	@IsBoolean()
	keepConnected = false;

	@IsOptional()
	@IsObject()
	@ValidateNested()
	@Type(() => SessionDeviceDto)
	@ApiProperty({ type: SessionDeviceDto, required: false })
	device?: SessionDeviceDto;
}
