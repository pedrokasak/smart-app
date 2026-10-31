import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from 'src/auth/enums/role.enum';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { AuditVerifyService } from 'src/audit/application/audit-verify.service';

export class VerifyAuditQueryDto {
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	fromSeq?: number;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	toSeq?: number;
}

/**
 * Verificação da trilha (ADR-004, seção 9.3). Só ADMIN: devolve ids e hashes,
 * nunca o conteúdo dos eventos.
 */
@Controller('admin/audit')
@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(RolesGuard)
export class AuditAdminController {
	constructor(private readonly verification: AuditVerifyService) {}

	@Get('verify')
	@Roles(Role.Admin)
	@ApiOperation({
		summary:
			'Recalcula a cadeia da trilha de auditoria e aponta o primeiro elo quebrado',
	})
	verify(@Query() query: VerifyAuditQueryDto) {
		return this.verification.verify(query);
	}
}
