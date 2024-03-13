import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateProfileDto } from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { PrismaService } from 'src/database/prisma.service';

@Injectable()
export class ProfileService {
	constructor(private readonly prisma: PrismaService) {}
	async create(createProfileDto: CreateProfileDto) {
		const { address, cpf, userId, permissionId } = createProfileDto;

		const findUser = await this.prisma.user.findUnique({
			where: {
				id: userId,
			},
		});

		if (!findUser)
			throw new NotFoundException(`User with ID ${userId} not found`);

		const findPermission = await this.prisma.permissions.findUnique({
			where: {
				id: permissionId,
			},
		});

		if (!findPermission)
			throw new NotFoundException(`User with ID ${findPermission} not found`);

		const profile = await this.prisma.profile.create({
			data: {
				address,
				cpf,
				user: { connect: { id: userId } },
				userId: userId,
				permissions: { connect: { id: permissionId } },
			},
		});

		return profile;
	}

	findAll() {
		return this.prisma.profile.findMany();
	}

	findOne(id: string) {
		return this.prisma.profile.findUnique({
			where: {
				id: id,
			},
		});
	}

	update(id: number, updateProfileDto: UpdateProfileDto) {
		return `This action updates a #${id} profile ${updateProfileDto}`;
	}

	remove(id: number) {
		return `This action removes a #${id} profile`;
	}
}
