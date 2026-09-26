import {
	Body,
	Controller,
	Delete,
	ForbiddenException,
	Get,
	Param,
	Patch,
	Post,
	Put,
	Req,
	UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import {
	CreateGoalDto,
	UpdateFinancialPlanDto,
	UpdateGoalDto,
} from './dto/financial-plan.dto';
import { FinancialPlanService } from './financial-plan.service';

import { OwnershipChecked } from 'src/auth/decorators/ownership.decorator';
function requireUserId(req: any): string {
	const userId = req.user?.userId ?? req.user?.sub;
	if (!userId) throw new ForbiddenException('Usuário não autenticado.');
	return String(userId);
}

/** Plano e metas do usuário do token (TRA-177). Sem variante por id. */
@Controller('financial-plan')
@ApiTags('financial-plan')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class FinancialPlanController {
	constructor(private readonly service: FinancialPlanService) {}

	@Get()
	@ApiOperation({ summary: 'Plano financeiro e metas' })
	get(@Req() req: any) {
		return this.service.get(requireUserId(req));
	}

	@Put()
	@ApiOperation({ summary: 'Atualiza aporte, retorno esperado e horizonte' })
	update(@Req() req: any, @Body() dto: UpdateFinancialPlanDto) {
		return this.service.updateSettings(requireUserId(req), dto);
	}

	@Post('goals')
	@ApiOperation({ summary: 'Cria uma meta' })
	addGoal(@Req() req: any, @Body() dto: CreateGoalDto) {
		return this.service.addGoal(requireUserId(req), dto);
	}

	@OwnershipChecked('findPlanWithGoal(userId, goalId)')
	@Patch('goals/:id')
	@ApiOperation({ summary: 'Atualiza uma meta' })
	updateGoal(
		@Req() req: any,
		@Param('id') id: string,
		@Body() dto: UpdateGoalDto
	) {
		return this.service.updateGoal(requireUserId(req), id, dto);
	}

	@OwnershipChecked('findPlanWithGoal(userId, goalId)')
	@Delete('goals/:id')
	@ApiOperation({ summary: 'Apaga uma meta' })
	removeGoal(@Req() req: any, @Param('id') id: string) {
		return this.service.removeGoal(requireUserId(req), id);
	}
}
