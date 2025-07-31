import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
	constructor() {}

	@Get('')
	async home(): Promise<any> {
		return 'Hello World';
	}

	@Get('health')
	async health(): Promise<any> {
		return 'OK';
	}
}
