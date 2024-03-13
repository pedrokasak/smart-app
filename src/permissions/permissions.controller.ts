import {
	Controller,
	Get,
	Post,
	Body,
	Patch,
	Param,
	Delete,
	UseGuards,
} from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { JwtAuthGuard } from 'src/signin/jwt-auth.guard';

@Controller('permissions')
export class PermissionsController {
	constructor(private readonly permissionsService: PermissionsService) {}

	@Post('create')
	@UseGuards(JwtAuthGuard)
	create(@Body() createPermissionDto: CreatePermissionDto) {
		return this.permissionsService.create(createPermissionDto);
	}

	@Get()
	@UseGuards(JwtAuthGuard)
	findAll() {
		return this.permissionsService.findAll();
	}

	@Get(':id')
	@UseGuards(JwtAuthGuard)
	findOne(@Param('id') id: string) {
		return this.permissionsService.findOne(+id);
	}

	@Patch(':id')
	@UseGuards(JwtAuthGuard)
	update(
		@Param('id') id: string,
		@Body() updatePermissionDto: UpdatePermissionDto
	) {
		return this.permissionsService.update(+id, updatePermissionDto);
	}

	@Delete(':id')
	remove(@Param('id') id: string) {
		return this.permissionsService.remove(+id);
	}
}
