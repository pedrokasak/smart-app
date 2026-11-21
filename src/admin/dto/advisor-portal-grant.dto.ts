import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsMongoId } from 'class-validator';

export class GrantAdvisorPortalDto {
	@ApiProperty({ description: 'E-mail da conta que recebe o portal' })
	@IsEmail()
	email: string;
}

export class AdvisorPortalUserParamDto {
	@ApiProperty({ description: 'Id da conta com a liberação' })
	@IsMongoId()
	userId: string;
}

export class AdvisorPortalGrantResponseDto {
	@ApiProperty()
	userId: string;
}

export class AdvisorPortalGrantListItemDto {
	@ApiProperty()
	userId: string;

	@ApiProperty({
		type: String,
		nullable: true,
		description: 'E-mail mascarado; null quando a conta não existe mais',
	})
	emailMasked: string | null;

	@ApiProperty({ type: String, format: 'date-time' })
	grantedAt: Date;
}
