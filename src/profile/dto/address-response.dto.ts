import { ApiProperty } from '@nestjs/swagger';
import { AddressType } from '../schema/address.model';

export class AddressResponseDto {
	@ApiProperty()
	id: string;

	@ApiProperty()
	profileId: string;

	@ApiProperty()
	street: string;

	@ApiProperty({ required: false })
	number?: string;

	@ApiProperty({ required: false })
	complement?: string;

	@ApiProperty()
	neighborhood: string;

	@ApiProperty()
	city: string;

	@ApiProperty()
	state: string;

	@ApiProperty()
	zipCode: string;

	@ApiProperty()
	isDefault: boolean;

	@ApiProperty({ enum: AddressType })
	type: AddressType;

	@ApiProperty()
	createdAt: Date;

	@ApiProperty()
	updatedAt: Date;
}
