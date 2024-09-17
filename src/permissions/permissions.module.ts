import { Module } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { PermissionsController } from './permissions.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { PermissionModel } from './schema/permissions.model';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'Permission', schema: PermissionModel.schema },
		]),
	],
	providers: [PermissionsService],
	controllers: [PermissionsController],
	exports: [PermissionsService],
})
export class PermissionsModule {}
