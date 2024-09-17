import { Controller, Get } from '@nestjs/common';
import { ConnectDatabase } from './database/database.service';

@Controller()
export class AppController {
	constructor(private readonly prisma: ConnectDatabase) {}

	@Get('')
	async home(): Promise<any> {
		return 'Hello World';
	}

	// @Post('create')
	// async createUser(): Promise<any> {
	// 	const response = await this.prisma.signIn.create({
	// 		data: {
	// 			email: 'pedrohesm@gmail.com',
	// 			password: 'teste123',
	// 			token:
	// 				'eyJhbGciOiJIUzI1NiJ9.eyJSb2xlIjoiQWRtaW4iLCJJc3N1ZXIiOiJJc3N1ZXIiLCJVc2VybmFtZSI6IkphdmFJblVzZSIsImV4cCI6MTcwOTQxNTE3NSwiaWF0IjoxNzA5NDE1MTc1fQ.MJr6SIHKHR0kCyAcpS7HXhaTm-V362GcCCTqzB1h26w',
	// 			keepConnected: true,
	// 		},
	// 	});
	// 	return {
	// 		response,
	// 	};
	// }
}
