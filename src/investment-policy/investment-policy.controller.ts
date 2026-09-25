import {
	Body,
	Controller,
	ForbiddenException,
	Get,
	Put,
	Req,
	UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { UpdateInvestmentPolicyDto } from './dto/update-investment-policy.dto';
import { InvestmentPolicyService } from './investment-policy.service';
import { RequiresCapability } from 'src/subscription/capabilities/requires-capability.decorator';

function requireUserId(req: any): string {
	const userId = req.user?.userId ?? req.user?.sub;
	if (!userId) throw new ForbiddenException('Usuário não autenticado.');
	return String(userId);
}

/** Só opera sobre o usuário do token: não existe variante por id. */
@RequiresCapability('policy.investment')
@Controller('investment-policy')
@ApiTags('investment-policy')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class InvestmentPolicyController {
	constructor(private readonly service: InvestmentPolicyService) {}

	@Get()
	@ApiOperation({ summary: 'Política de investimento do usuário autenticado' })
	get(@Req() req: any) {
		return this.service.get(requireUserId(req));
	}

	@Put()
	@ApiOperation({
		summary: 'Salva uma nova versão da política de investimento',
	})
	save(@Req() req: any, @Body() dto: UpdateInvestmentPolicyDto) {
		return this.service.save(requireUserId(req), dto);
	}

	@Get('versions')
	@ApiOperation({
		summary: 'Versões anteriores da política (mais recente primeiro)',
	})
	versions(@Req() req: any) {
		return this.service.listVersions(requireUserId(req));
	}
}
