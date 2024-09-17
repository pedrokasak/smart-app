import { Injectable, NotFoundException } from '@nestjs/common';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Permission } from './schema/permissions.model';

@Injectable()
export class PermissionsService {
	constructor(
		@InjectModel('Permission')
		private readonly permissionModel: Model<Permission>
	) {}
	async create(createPermissionDto: CreatePermissionDto) {
		const { name, profileId } = createPermissionDto;

		const profile = await this.permissionModel.find({
			id: profileId,
		});
		if (!profile)
			throw new NotFoundException(`User with ID ${profile} not found`);

		const permission = await this.permissionModel.create({
			name,
			profile: { connect: { id: profileId } },
		});

		return permission;
	}

	findAll() {
		return this.permissionModel.find();
	}

	findOne(id: number) {
		return `This action returns a #${id} permission`;
	}

	update(id: number, updatePermissionDto: UpdatePermissionDto) {
		return `This action updates a #${id} permission ${updatePermissionDto}`;
	}

	remove(id: number) {
		return `This action removes a #${id} permission`;
	}
}
