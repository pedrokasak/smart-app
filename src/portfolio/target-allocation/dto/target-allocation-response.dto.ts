import { ApiProperty } from '@nestjs/swagger';

export class TargetAllocationResponseDto {
	@ApiProperty({ required: false })
	stocks?: number;

	@ApiProperty({ required: false })
	crypto?: number;

	@ApiProperty({ required: false })
	fiis?: number;

	@ApiProperty({ required: false })
	other?: number;
}
