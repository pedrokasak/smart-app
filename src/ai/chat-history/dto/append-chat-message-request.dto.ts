import {
	IsBoolean,
	IsIn,
	IsObject,
	IsOptional,
	IsString,
	MaxLength,
} from 'class-validator';

/**
 * Mesmo teto de POST /ai/chat/intelligent (TRA-89): sem limite, o corpo de
 * uma mensagem persistida poderia crescer sem controle por requisição.
 */
const MAX_TEXT_LENGTH = 4000;

export class AppendChatMessageRequestDto {
	@IsString()
	@MaxLength(200)
	clientId: string;

	@IsIn(['user', 'assistant'])
	role: 'user' | 'assistant';

	@IsString()
	@MaxLength(MAX_TEXT_LENGTH)
	text: string;

	@IsOptional()
	@IsIn(['ok', 'error'])
	status?: 'ok' | 'error';

	@IsOptional()
	@IsString()
	@MaxLength(MAX_TEXT_LENGTH)
	retryQuestion?: string;

	@IsOptional()
	@IsObject()
	payload?: Record<string, unknown>;

	@IsOptional()
	@IsBoolean()
	aiGenerated?: boolean;
}
