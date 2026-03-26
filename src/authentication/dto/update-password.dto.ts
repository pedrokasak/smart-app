import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

export class UpdatePasswordDto {
	@IsString()
	@IsNotEmpty()
	oldPassword!: string;

	@IsString()
	@IsNotEmpty()
	@MinLength(8, {
		message: 'A senha deve conter no mínimo 8 caracteres',
	})
	@Matches(/[A-Z]/, {
		message: 'A senha deve conter pelo menos 1 letra maiúscula',
	})
	@Matches(/[a-z]/, {
		message: 'A senha deve conter pelo menos 1 letra minúscula',
	})
	@Matches(/\d/, {
		message: 'A senha deve conter pelo menos 1 número',
	})
	@Matches(/[^A-Za-z0-9]/, {
		message: 'A senha deve conter pelo menos 1 caractere especial',
	})
	newPassword!: string;
}
