import {
	Injectable,
	CanActivate,
	ExecutionContext,
	ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../enums/role.enum';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
	constructor(private reflector: Reflector) {}

	canActivate(context: ExecutionContext): boolean {
		const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
			context.getHandler(),
			context.getClass(),
		]);

		// If no roles are required, allow access
		if (!requiredRoles || requiredRoles.length === 0) {
			return true;
		}

		const request = context.switchToHttp().getRequest();
		const user = request.user;

		if (!user) {
			throw new ForbiddenException('Usuário não autenticado');
		}

		const userRole: Role = user.role ?? Role.User;
		const hasRole = requiredRoles.some((role) => userRole === role);

		if (!hasRole) {
			throw new ForbiddenException(
				`Acesso negado. Requer perfil: ${requiredRoles.join(' ou ')}. Seu perfil: ${userRole}`
			);
		}

		return true;
	}
}
