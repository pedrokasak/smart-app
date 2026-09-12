import { Transform, Type } from 'class-transformer';
import {
	IsBoolean,
	IsInt,
	IsOptional,
	IsString,
	Max,
	Min,
} from 'class-validator';
import {
	DEFAULT_IN_APP_PAGE_SIZE,
	MAX_IN_APP_PAGE_SIZE,
} from '../domain/in-app-notification.types';

/**
 * Query do centro in-app. Note que NAO existe `userId` aqui — ao contrario
 * do DTO do admin, o dono vem do JWT. Com `forbidNonWhitelisted: true` no
 * ValidationPipe global, mandar `userId=<outro>` na query e 400, nao um
 * parametro silenciosamente ignorado.
 */
export class ListInAppNotificationsQueryDto {
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(MAX_IN_APP_PAGE_SIZE)
	limit?: number = DEFAULT_IN_APP_PAGE_SIZE;

	@IsOptional()
	@IsString()
	cursor?: string;

	/** Query string chega como texto: 'true'/'1' viram boolean antes do check. */
	@IsOptional()
	@Transform(({ value }) => {
		if (typeof value === 'boolean') return value;
		if (value === 'true' || value === '1') return true;
		if (value === 'false' || value === '0') return false;
		return value;
	})
	@IsBoolean()
	unreadOnly?: boolean;
}
