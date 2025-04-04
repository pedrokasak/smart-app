import { CreateUserDto } from '../dto/create-user.dto';

export abstract class UsersRepository {
	abstract create(createUserDto: CreateUserDto): Promise<void>;
}
