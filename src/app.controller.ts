import { Controller, Get } from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from 'src/utils/constants';

@Controller()
@ApiTags('Health')
export class AppController {
	constructor() {}

	@Get('health')
	@Public()
	@ApiResponse({ status: 200 })
	async health(): Promise<any> {
		return 'OK';
	}
}
