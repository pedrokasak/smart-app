import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
	ArrayMaxSize,
	ArrayMinSize,
	IsArray,
	IsIn,
	IsObject,
	IsOptional,
	IsString,
	IsUUID,
	Matches,
	ValidateIf,
	ValidateNested,
} from 'class-validator';
import type { EmailDraft } from 'src/advisor/application/attention/alert.service';
import { ALERT_BULK_MAX } from 'src/advisor/application/attention/alert.service';
import type { AlertPage } from 'src/advisor/application/ports/alert.store.port';
import type { Alert } from 'src/advisor/domain/attention.entities';
import {
	AlertHandledVia,
	AlertPriority,
	AlertRule,
	AlertStatus,
	PortfolioProvenance,
	SnapshotSource,
} from 'src/advisor/domain/enums';
import { ASSIGNEE_FILTER_PATTERN, PageQueryDto } from './client.dto';

/** Datas de calendário do BFF: `YYYY-MM-DD`. O serviço confere o dia. */
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const ALERT_BULK_ACTIONS = ['REVIEW', 'SNOOZE', 'DISMISS'] as const;

const PRIORITIES = Object.values(AlertPriority);
const RULES = Object.values(AlertRule);
const STATUSES = Object.values(AlertStatus);

/**
 * `?priority=P0,P1` ou `?priority=P0&priority=P1`: os dois viram uma lista.
 * Valor vazio vira ausente.
 */
const toList = ({ value }: { value: unknown }): unknown => {
	if (value === undefined || value === null || value === '') return undefined;
	const parts = (Array.isArray(value) ? value : [value]).flatMap((v) =>
		typeof v === 'string' ? v.split(',').map((p) => p.trim()) : [v]
	);
	return parts;
};

const LIST_DESCRIPTION = 'Lista separada por vírgula ou o parâmetro repetido';

/** O lote só age sobre alertas ativos. */
const BULK_STATUSES = [AlertStatus.Open, AlertStatus.Snoozed];

const ASSIGNEE_DESCRIPTION =
	'Só ORG_ADMIN: me, none (sem atribuição) ou o userId de um membro. Para o ADVISOR a fila já vem filtrada e o parâmetro é 400 ASSIGNEE_FILTER_FORBIDDEN';

export class ListAlertsQueryDto extends PageQueryDto {
	@ApiPropertyOptional({
		enum: AlertStatus,
		isArray: true,
		default: [AlertStatus.Open],
		description: LIST_DESCRIPTION,
		example: 'OPEN,SNOOZED',
	})
	@IsOptional()
	@Transform(toList)
	@IsIn(STATUSES, { each: true })
	status?: AlertStatus[];

	@ApiPropertyOptional({
		enum: AlertPriority,
		isArray: true,
		description: LIST_DESCRIPTION,
		example: 'P0,P1',
	})
	@IsOptional()
	@Transform(toList)
	@IsIn(PRIORITIES, { each: true })
	priority?: AlertPriority[];

	@ApiPropertyOptional({
		enum: AlertRule,
		isArray: true,
		description: LIST_DESCRIPTION,
	})
	@IsOptional()
	@Transform(toList)
	@IsIn(RULES, { each: true })
	rule?: AlertRule[];

	@ApiPropertyOptional({
		pattern: ASSIGNEE_FILTER_PATTERN.source,
		description: ASSIGNEE_DESCRIPTION,
	})
	@IsOptional()
	@IsString()
	@Matches(ASSIGNEE_FILTER_PATTERN)
	assignee?: string;
}

/** O tamanho do título e da nota é regra do serviço (`details.field`). */
export class CreateAlertDto {
	@ApiProperty({ format: 'uuid', description: 'Id do cliente' })
	@IsUUID()
	clientId: string;

	@ApiProperty({ minLength: 1, maxLength: 120 })
	@IsString()
	title: string;

	@ApiProperty({ enum: AlertPriority })
	@IsIn(PRIORITIES)
	priority: AlertPriority;

	@ApiPropertyOptional({ description: 'YYYY-MM-DD', example: '2025-07-01' })
	@IsOptional()
	@IsString()
	@Matches(ISO_DATE_PATTERN)
	dueDate?: string;

	@ApiPropertyOptional({ maxLength: 500 })
	@IsOptional()
	@IsString()
	note?: string;
}

export class HandleAlertDto {
	@ApiProperty({ enum: AlertHandledVia })
	@IsIn(Object.values(AlertHandledVia))
	via: AlertHandledVia;

	@ApiPropertyOptional({ maxLength: 500 })
	@IsOptional()
	@IsString()
	note?: string;
}

export class SnoozeAlertDto {
	@ApiProperty({
		description: 'YYYY-MM-DD, depois de hoje e até 90 dias à frente',
		example: '2025-07-01',
	})
	@IsString()
	@Matches(ISO_DATE_PATTERN)
	until: string;
}

export class DismissAlertDto {
	@ApiProperty({ minLength: 1, maxLength: 300 })
	@IsString()
	reason: string;
}

export class BulkAlertFilterDto {
	@ApiPropertyOptional({
		enum: BULK_STATUSES,
		isArray: true,
		description: 'Só OPEN e SNOOZED (o lote só age sobre ativos); padrão OPEN',
	})
	@IsOptional()
	@IsArray()
	@IsIn(BULK_STATUSES, { each: true })
	statuses?: AlertStatus[];

	@ApiPropertyOptional({ enum: AlertPriority, isArray: true })
	@IsOptional()
	@IsArray()
	@IsIn(PRIORITIES, { each: true })
	priorities?: AlertPriority[];

	@ApiPropertyOptional({ enum: AlertRule, isArray: true })
	@IsOptional()
	@IsArray()
	@IsIn(RULES, { each: true })
	rules?: AlertRule[];

	@ApiPropertyOptional({
		pattern: ASSIGNEE_FILTER_PATTERN.source,
		description: ASSIGNEE_DESCRIPTION,
	})
	@IsOptional()
	@IsString()
	@Matches(ASSIGNEE_FILTER_PATTERN)
	assignee?: string;
}

/** `ids` ou `filter`, nunca os dois (400 com `details.field: ids`). */
export class BulkAlertsDto {
	@ApiProperty({ enum: ALERT_BULK_ACTIONS })
	@IsIn(ALERT_BULK_ACTIONS)
	action: (typeof ALERT_BULK_ACTIONS)[number];

	@ApiPropertyOptional({
		type: [String],
		format: 'uuid',
		minItems: 1,
		maxItems: ALERT_BULK_MAX,
	})
	// `null` não é ausência: valida e dá 400 (IsOptional deixaria passar).
	@ValidateIf((o: BulkAlertsDto) => o.ids !== undefined)
	@IsArray()
	@ArrayMinSize(1)
	@ArrayMaxSize(ALERT_BULK_MAX)
	@IsUUID(undefined, { each: true })
	ids?: string[];

	@ApiPropertyOptional({
		type: BulkAlertFilterDto,
		description: 'Até 500 alertas; acima disso, 400 com details.max',
	})
	@ValidateIf((o: BulkAlertsDto) => o.filter !== undefined)
	@IsObject()
	@ValidateNested()
	@Type(() => BulkAlertFilterDto)
	filter?: BulkAlertFilterDto;

	@ApiPropertyOptional({
		description: 'Com SNOOZE: YYYY-MM-DD, até 90 dias à frente',
	})
	@IsOptional()
	@IsString()
	@Matches(ISO_DATE_PATTERN)
	until?: string;

	@ApiPropertyOptional({ description: 'Com DISMISS', maxLength: 300 })
	@IsOptional()
	@IsString()
	reason?: string;
}

/**
 * Um alerta da fila. O texto vai como `messageKey` + `params`, sem tradução:
 * a tela monta a frase. Nunca carrega e-mail; ids de usuário ficam de fora.
 */
export class AlertResponseDto {
	@ApiProperty()
	id: string;

	@ApiProperty()
	clientProfileId: string;

	@ApiProperty({ enum: AlertRule })
	rule: AlertRule;

	@ApiProperty({ enum: SnapshotSource, nullable: true })
	source: SnapshotSource | null;

	@ApiPropertyOptional({
		description: 'Só na carteira compartilhada do B2C: a carteira de origem',
	})
	portfolioId?: string;

	@ApiProperty({
		description:
			'Objeto da regra: símbolo, classe, portfolio, client ou, em MANUAL, um id',
	})
	key: string;

	@ApiProperty({ enum: AlertPriority })
	priority: AlertPriority;

	@ApiProperty({ enum: AlertStatus })
	status: AlertStatus;

	@ApiProperty({ example: 'advisor.alert.position_drop' })
	messageKey: string;

	@ApiProperty({
		type: 'object',
		additionalProperties: { oneOf: [{ type: 'string' }, { type: 'number' }] },
		description: 'Parâmetros da mensagem, sem tradução',
	})
	params: Record<string, string | number>;

	@ApiProperty({
		type: 'object',
		additionalProperties: true,
		description: 'Fatos que geraram o alerta (valores em centavos ou %)',
	})
	evidence: Record<string, string | number | null>;

	@ApiProperty({ description: 'Data do dado usado, YYYY-MM-DD' })
	dataAsOf: string;

	@ApiProperty({ enum: PortfolioProvenance, nullable: true })
	provenance: PortfolioProvenance | null;

	@ApiProperty({ description: 'Prioridade rebaixada pela confiança do dado' })
	lowConfidence: boolean;

	@ApiPropertyOptional({ description: 'Só em MANUAL' })
	title?: string;

	@ApiPropertyOptional({ description: 'Nota da criação (MANUAL)' })
	note?: string;

	@ApiPropertyOptional({ description: 'Prazo (MANUAL), YYYY-MM-DD' })
	dueDate?: string;

	@ApiPropertyOptional({ description: 'Adiado até, YYYY-MM-DD' })
	snoozedUntil?: string;

	@ApiPropertyOptional({ enum: AlertHandledVia })
	handledVia?: AlertHandledVia;

	@ApiPropertyOptional({ description: 'Nota de quem tratou' })
	handledNote?: string;

	@ApiPropertyOptional()
	dismissReason?: string;

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: Date;

	@ApiProperty({ type: String, format: 'date-time' })
	updatedAt: Date;

	@ApiPropertyOptional({ type: String, format: 'date-time' })
	closedAt?: Date;

	/** Lista fechada de campos: nada do alerta passa sem estar aqui. */
	static of(a: Alert): AlertResponseDto {
		return {
			id: a.id,
			clientProfileId: a.clientProfileId,
			rule: a.rule,
			source: a.source,
			...(a.portfolioId !== undefined && { portfolioId: a.portfolioId }),
			key: a.key,
			priority: a.priority,
			status: a.status,
			messageKey: a.messageKey,
			params: { ...a.params },
			evidence: { ...a.evidence },
			dataAsOf: a.dataAsOf,
			provenance: a.provenance,
			lowConfidence: a.lowConfidence,
			...(a.title !== undefined && { title: a.title }),
			...(a.note !== undefined && { note: a.note }),
			...(a.dueDate !== undefined && { dueDate: a.dueDate }),
			...(a.snoozedUntil !== undefined && { snoozedUntil: a.snoozedUntil }),
			...(a.handledVia !== undefined && { handledVia: a.handledVia }),
			...(a.handledNote !== undefined && { handledNote: a.handledNote }),
			...(a.dismissReason !== undefined && {
				dismissReason: a.dismissReason,
			}),
			createdAt: a.createdAt,
			updatedAt: a.updatedAt,
			...(a.closedAt !== undefined && { closedAt: a.closedAt }),
		};
	}
}

export class AlertPageResponseDto {
	@ApiProperty({ type: [AlertResponseDto] })
	items: AlertResponseDto[];

	@ApiProperty({ type: String, nullable: true })
	nextCursor: string | null;

	static of(page: AlertPage): AlertPageResponseDto {
		return {
			items: page.items.map(AlertResponseDto.of),
			nextCursor: page.nextCursor,
		};
	}
}

export class EmailDraftResponseDto {
	@ApiPropertyOptional({
		description:
			'E-mail do convite aceito que criou o vínculo, só com vínculo ACTIVE; ausente nos demais casos',
	})
	to?: string;

	@ApiProperty()
	subject: string;

	@ApiProperty()
	body: string;
}

export class HandleAlertResponseDto {
	@ApiProperty({ type: AlertResponseDto })
	alert: AlertResponseDto;

	@ApiPropertyOptional({
		type: EmailDraftResponseDto,
		description: 'Só com via EMAIL',
	})
	emailDraft?: EmailDraftResponseDto;

	static of(result: {
		alert: Alert;
		emailDraft?: EmailDraft;
	}): HandleAlertResponseDto {
		const draft = result.emailDraft;
		return {
			alert: AlertResponseDto.of(result.alert),
			...(draft && {
				emailDraft: {
					...(draft.to !== undefined && { to: draft.to }),
					subject: draft.subject,
					body: draft.body,
				},
			}),
		};
	}
}

export class BulkAlertsResponseDto {
	@ApiProperty({ description: 'Alertas alterados' })
	affected: number;

	@ApiProperty({
		description:
			'Ids fora do alcance, inexistentes ou que já não estavam ativos',
	})
	skipped: number;
}
