import { Controller, Get, Post } from '@nestjs/common';
import { PrismaService } from './database/prisma.service';

@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('login')
  async getUser(): Promise<any> {
    const response = await this.prisma.signIn.findMany();
    return response;
  }

  @Post('create')
  async createUser(): Promise<any> {
    const response = await this.prisma.signIn.create({
      data: {
        email: 'pedrohesm@gmail.com',
        password: 'teste123',
        token:
          'eyJhbGciOiJIUzI1NiJ9.eyJSb2xlIjoiQWRtaW4iLCJJc3N1ZXIiOiJJc3N1ZXIiLCJVc2VybmFtZSI6IkphdmFJblVzZSIsImV4cCI6MTcwOTQxNTE3NSwiaWF0IjoxNzA5NDE1MTc1fQ.MJr6SIHKHR0kCyAcpS7HXhaTm-V362GcCCTqzB1h26w',
        keepConnected: true,
      },
    });
    return {
      response,
    };
  }
}
