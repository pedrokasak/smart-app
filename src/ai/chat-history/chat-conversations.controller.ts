import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Patch,
	Post,
	Request,
	UnauthorizedException,
	UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { OwnershipChecked } from 'src/auth/decorators/ownership.decorator';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { ChatConversationService } from './chat-conversation.service';

class CreateConversationDto {
	@IsOptional()
	@IsString()
	@MaxLength(120)
	title?: string;
}

class RenameConversationDto {
	@IsString()
	@MinLength(1)
	@MaxLength(120)
	title: string;
}

/**
 * Conversas do Chat Inteligente (ADR-007, fase 2). Sem gate de plano no
 * backend, como o histórico (`/ai/chat/history`): ver e apagar as próprias
 * conversas vale em qualquer plano.
 */
@Controller('ai/chat/conversations')
@ApiTags('ai')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class ChatConversationsController {
	constructor(private readonly conversations: ChatConversationService) {}

	@Get()
	list(@Request() req: any) {
		return this.conversations.list(userIdOf(req));
	}

	@Post()
	create(@Request() req: any, @Body() body: CreateConversationDto) {
		return this.conversations.create(userIdOf(req), body.title);
	}

	@Patch(':id')
	@OwnershipChecked('ChatConversationService filtra por userId do JWT (404)')
	rename(
		@Request() req: any,
		@Param('id') id: string,
		@Body() body: RenameConversationDto
	) {
		return this.conversations.rename(userIdOf(req), id, body.title);
	}

	@Delete(':id')
	@OwnershipChecked('ChatConversationService filtra por userId do JWT (404)')
	remove(@Request() req: any, @Param('id') id: string) {
		return this.conversations.remove(userIdOf(req), id);
	}
}

function userIdOf(req: any): string {
	const userId = String(req.user?.userId ?? req.user?.sub ?? '');
	if (!userId) throw new UnauthorizedException('User ID ausente no token');
	return userId;
}
