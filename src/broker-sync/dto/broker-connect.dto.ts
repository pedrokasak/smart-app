import { IsString, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class BrokerConnectDto {
	@ApiProperty({
		description: 'ID do provider: binance, coinbase, b3, mercadobitcoin, etc.',
	})
	@IsString()
	provider: string;

	@ApiProperty({ required: false })
	@IsOptional()
	@IsString()
	apiKey?: string;

	@ApiProperty({ required: false })
	@IsOptional()
	@IsString()
	apiSecret?: string;

	@ApiProperty({ required: false, description: 'CPF para conectar B3' })
	@IsOptional()
	@IsString()
	cpf?: string;
}
