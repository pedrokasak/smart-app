import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum } from 'class-validator';
import { Role } from 'src/auth/enums/role.enum';

export class UpdateUserRoleByEmailDto {
	@ApiProperty()
	@IsEmail()
	email: string;

	@ApiProperty({ enum: [Role.Editor, Role.Admin] })
	@IsEnum(Role)
	role: Role;
}
