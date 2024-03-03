import { Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { PrismaService } from 'src/database/prisma.service';
import { randomUUID } from 'node:crypto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto) {
    const { first_name, last_name, email, password, repeat_password } =
      createUserDto;
    await this.prisma.user.create({
      data: {
        id: randomUUID(),
        first_name,
        last_name,
        email,
        password,
        repeat_password,
      },
    });
    return createUserDto;
  }

  async findMany() {
    return await this.prisma.user.findMany();
  }

  async findOne(id: string) {
    const data = await this.prisma.user.findUnique({
      where: {
        id,
      },
    });

    return data;
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    const response = await this.prisma.user.update({
      where: {
        id,
      },
      data: {
        ...updateUserDto,
      },
    });

    return response;
  }

  async delete(id: string) {
    const response = await this.prisma.user.delete({
      where: {
        id,
      },
    });
    return response;
  }
}
