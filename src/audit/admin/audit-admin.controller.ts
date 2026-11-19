import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
	IsInt,
	IsOptional,
	IsString,
	Max,
	MaxLength,
	Min,
} from 'class-validator';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from 'src/auth/enums/role.enum';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import {
	AUDIT_LIST_MAX,
	AuditListService,
} from 'src/audit/application/audit-list.service';
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

export class ListAuditEventsQueryDto {
	@IsOptional()
	@IsString()
	@MaxLength(80)
	type?: string;

	@IsOptional()
	@IsString()
	@MaxLength(120)
	subject?: string;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(AUDIT_LIST_MAX)
	limit?: number;

	@IsOptional()
	@IsString()
	@MaxLength(200)
	cursor?: string;
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
	constructor(
		private readonly verification: AuditVerifyService,
		private readonly listing: AuditListService
	) {}

	@Get('verify')
	@Roles(Role.Admin)
	@ApiOperation({
		summary:
			'Recalcula a cadeia da trilha de auditoria e aponta o primeiro elo quebrado',
	})
	verify(@Query() query: VerifyAuditQueryDto) {
		return this.verification.verify(query);
	}

	@Get('events')
	@Roles(Role.Admin)
	@ApiOperation({
		summary:
			'Lista os eventos da trilha, do mais novo ao mais antigo, só com metadados',
	})
	events(@Query() query: ListAuditEventsQueryDto) {
		return this.listing.list(query);
	}
}
