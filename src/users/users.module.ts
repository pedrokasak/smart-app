import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { MongooseModule } from '@nestjs/mongoose';
import { UserModel } from './schema/user.model';

@Module({
	imports: [
		MongooseModule.forFeature([{ name: 'User', schema: UserModel.schema }]),
	],
	providers: [UsersService],
	exports: [UsersService, MongooseModule],
})
export class UsersModule {}
