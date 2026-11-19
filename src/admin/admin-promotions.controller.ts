import {
	Body,
	Controller,
	Get,
	Param,
	Patch,
	Post,
	Req,
	UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from 'src/auth/enums/role.enum';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { AdminPromotionsService } from './application/admin-promotions.service';
import { CreatePromotionDto } from './dto/promotion.dto';

/** Cupons do Stripe gerenciados pelo admin (TRA-182). Só admin. */
@Controller('admin/promotions')
@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(RolesGuard)
@Roles(Role.Admin)
export class AdminPromotionsController {
	constructor(private readonly promotions: AdminPromotionsService) {}

	@Get()
	@ApiOperation({ summary: 'Cupons ativos com o contador de resgates' })
	list() {
		return this.promotions.list();
	}

	@Post()
	@ApiOperation({ summary: 'Cria cupom e código promocional no Stripe' })
	create(@Req() req: any, @Body() body: CreatePromotionDto) {
		return this.promotions.create(body, String(req.user?.userId ?? ''));
	}

	@Patch(':id/deactivate')
	@ApiOperation({ summary: 'Desativa o código promocional' })
	deactivate(@Req() req: any, @Param('id') id: string) {
		return this.promotions.deactivate(id, String(req.user?.userId ?? ''));
	}
}
