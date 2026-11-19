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

export class GoogleSigninDto {
	@ApiProperty({
		description: 'Google ID token returned by Google Identity Services',
	})
	@IsString()
	@IsNotEmpty()
	@MinLength(40)
	@MaxLength(4000)
	idToken: string;

	@ApiProperty({
		description: 'Whether session should be kept connected',
		required: false,
		default: false,
	})
	@IsBoolean()
	keepConnected = false;

	@IsOptional()
	@IsObject()
	@ValidateNested()
	@Type(() => SessionDeviceDto)
	@ApiProperty({ type: SessionDeviceDto, required: false })
	device?: SessionDeviceDto;
}
