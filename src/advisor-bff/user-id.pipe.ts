import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { isMongoId } from 'class-validator';

/**
 * Id de usuário do projeto (ObjectId do Mongo, 24 hex). Fora do formato é
 * 400 sem `reason`, como o `ParseUUIDPipe` dos ids do Advisor.
 */
@Injectable()
export class ParseUserIdPipe implements PipeTransform<unknown, string> {
	transform(value: unknown): string {
		if (typeof value !== 'string' || !isMongoId(value)) {
			throw new BadRequestException('Validation failed (user id expected)');
		}
		return value;
	}
}
