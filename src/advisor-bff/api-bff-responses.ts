import { applyDecorators } from '@nestjs/common';
import { ApiHeader, ApiResponse } from '@nestjs/swagger';
import { ErrorResponseDto } from './dto/error-response.dto';

/**
 * Respostas comuns a toda rota do BFF, no nível da classe: 401 sem JWT e 429
 * do limite padrão por conta. Rota com limite próprio documenta o seu 429 no
 * método, que prevalece.
 */
export function ApiBffCommonResponses(): ClassDecorator {
	return applyDecorators(
		ApiResponse({
			status: 401,
			type: ErrorResponseDto,
			description: 'Sem JWT de acesso válido',
		}),
		ApiResponse({
			status: 429,
			type: ErrorResponseDto,
			description: 'Limite padrão de 300 requisições por minuto por conta',
		})
	);
}

/** Header obrigatório das rotas com org ativa (`OrgContextGuard`). */
export function ApiOrgHeader(): ClassDecorator {
	return applyDecorators(
		ApiHeader({
			name: 'x-org-id',
			required: true,
			description:
				'Id da organização ativa. Ausente ou em branco: 403 ORG_HEADER_REQUIRED; org de que o usuário não é membro: 403',
		})
	);
}

/** 400 do ValidationPipe: corpo ou query fora do DTO, sem as mensagens. */
export const VALIDATION_FAILED_DESCRIPTION =
	'VALIDATION_FAILED (corpo ou query fora do formato)';

/** O ParseUUIDPipe responde 400 sem `reason`. */
export const INVALID_ID_DESCRIPTION = 'id fora do formato UUID (sem reason)';
