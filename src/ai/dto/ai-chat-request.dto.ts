import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Entrada do `/ai/chat` legado (TRA-89).
 *
 * A rota recebia `@Body() body: any`. Sem classe, o `ValidationPipe` global
 * não tem o que validar e o corpo inteiro — até o limite de 1MB do servidor
 * — seguia para o LLM. Cada requisição custa uma chamada paga proporcional
 * ao tamanho do prompt.
 *
 * `profile_plan` ficou de fora de propósito: era enviado pelo cliente e o
 * trackerr-ia o usava para decidir a profundidade da análise, ou seja,
 * bastava declarar-se premium. Plano é decidido no servidor, a partir da
 * assinatura.
 */
export class AiChatRequestDto {
	@ApiProperty({ description: 'Pergunta do usuário' })
	@IsString()
	@MaxLength(2000)
	question: string;

	@ApiPropertyOptional({
		description: 'Contexto adicional da carteira',
		type: Object,
	})
	@IsOptional()
	@IsObject()
	context?: Record<string, unknown>;
}
