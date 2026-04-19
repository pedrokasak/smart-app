import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Patch,
	Post,
	Req,
	UseGuards,
} from '@nestjs/common';
import {
	ApiBearerAuth,
	ApiOperation,
	ApiTags,
} from '@nestjs/swagger';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Role } from 'src/auth/enums/role.enum';
import { CreateSubscriptionDto } from 'src/subscription/dto/create-subscription.dto';
import { UpdateSubscriptionDto } from 'src/subscription/dto/update-subscription.dto';
import { AdminService } from './admin.service';
import { ManualGrantDto } from './dto/manual-grant.dto';
import { UpdateUserRoleByEmailDto } from './dto/update-user-role-by-email.dto';

@Controller('admin')
@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(RolesGuard)
export class AdminController {
	constructor(private readonly adminService: AdminService) {}

	@Get('overview')
	@Roles(Role.Admin)
	@ApiOperation({ summary: 'Retorna métricas do dashboard admin' })
	getOverview() {
		return this.adminService.getOverview();
	}

	@Get('plans')
	@Roles(Role.Admin, Role.Editor)
	@ApiOperation({ summary: 'Lista planos administrativos' })
	listPlans() {
		return this.adminService.listPlans();
	}

	@Post('plans')
	@Roles(Role.Admin)
	@ApiOperation({ summary: 'Cria plano com sincronização Stripe' })
	createPlan(@Body() body: CreateSubscriptionDto) {
		return this.adminService.createPlan(body);
	}

	@Patch('plans/:id')
	@Roles(Role.Admin)
	@ApiOperation({ summary: 'Atualiza plano com sincronização Stripe' })
	updatePlan(@Param('id') id: string, @Body() body: UpdateSubscriptionDto) {
		return this.adminService.updatePlan(id, body);
	}

	@Delete('plans/:id')
	@Roles(Role.Admin)
	@ApiOperation({ summary: 'Desativa plano no painel admin' })
	deactivatePlan(@Param('id') id: string) {
		return this.adminService.deactivatePlan(id);
	}

	@Post('users/role')
	@Roles(Role.Admin)
	@ApiOperation({ summary: 'Promove usuário para admin/editor via email' })
	updateUserRole(@Body() body: UpdateUserRoleByEmailDto) {
		return this.adminService.updateUserRoleByEmail(body.email, body.role);
	}

	@Post('grants')
	@Roles(Role.Admin, Role.Editor)
	@ApiOperation({ summary: 'Concede assinatura manual via email' })
	grantSubscription(@Req() req: any, @Body() body: ManualGrantDto) {
		return this.adminService.grantSubscriptionByEmail(req.user.userId, body);
	}
}
