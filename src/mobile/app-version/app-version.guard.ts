import {
	CanActivate,
	ExecutionContext,
	HttpException,
	Inject,
	Injectable,
} from '@nestjs/common';
import { meetsMinimumVersion } from './app-version.policy';

export const MOBILE_MIN_APP_VERSION = Symbol('MOBILE_MIN_APP_VERSION');

export const APP_VERSION_HEADER = 'x-app-version';

/** O enum HttpStatus do Nest não tem o 426. */
const UPGRADE_REQUIRED = 426;

/**
 * Recusa versões do app velhas demais para o contrato atual. A loja não força
 * atualização, então esta é a única forma de avisar quem ficou para trás.
 */
@Injectable()
export class AppVersionGuard implements CanActivate {
	constructor(
		@Inject(MOBILE_MIN_APP_VERSION) private readonly minimumVersion: string
	) {}

	canActivate(context: ExecutionContext): boolean {
		const request = context.switchToHttp().getRequest();
		const version = request.headers?.[APP_VERSION_HEADER];

		if (!meetsMinimumVersion(version, this.minimumVersion)) {
			throw new HttpException(
				{
					statusCode: UPGRADE_REQUIRED,
					message: 'Atualize o app para continuar.',
					minVersion: this.minimumVersion,
				},
				UPGRADE_REQUIRED
			);
		}
		return true;
	}
}
