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
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from 'src/auth/enums/role.enum';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

@Controller('permissions')
@ApiTags('permissions')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Admin) // All permission routes require Admin role
export class PermissionsController {
	constructor(private readonly permissionsService: PermissionsService) {}

	@Post('create')
	@ApiOkResponse({
		description: 'Create a new permission',
		schema: {
			type: 'object',
			properties: {
				permission: {
					type: 'string',
					description: 'The created permission',
				},
			},
		},
	})
	create(@Body() createPermissionDto: CreatePermissionDto) {
		return this.permissionsService.create(createPermissionDto);
	}

	@Get()
	findAll() {
		return this.permissionsService.findAll();
	}

	@Get(':id')
	findOne(@Param('id') id: string) {
		return this.permissionsService.findOne(+id);
	}

	@Patch(':id')
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
