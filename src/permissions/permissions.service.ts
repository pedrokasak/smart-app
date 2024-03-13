import { Injectable, NotFoundException } from '@nestjs/common';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { PrismaService } from 'src/database/prisma.service';

@Injectable()
export class PermissionsService {
	constructor(private readonly prisma: PrismaService) {}
	async create(createPermissionDto: CreatePermissionDto) {
		const { name, profileId } = createPermissionDto;

		const profile = await this.prisma.profile.findUnique({
			where: {
				id: profileId,
			},
		});
		if (!profile)
			throw new NotFoundException(`User with ID ${profile} not found`);

		const permission = await this.prisma.permissions.create({
			data: {
				name,
				profile: { connect: { id: profileId } },
			},
		});

		return permission;
	}

	findAll() {
		return this.prisma.permissions.findMany();
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
