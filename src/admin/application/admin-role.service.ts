import {
	BadRequestException,
	Injectable,
	Logger,
	NotFoundException,
	OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Role } from 'src/auth/enums/role.enum';
import { User } from 'src/users/schema/user.model';
import {
	ROLE_CHANGE_BOOTSTRAP_ACTOR,
	RoleChangeAudit,
} from '../schema/role-change-audit.model';
import {
	bootstrapAdminEmail,
	canBootstrapAdmin,
} from './admin-bootstrap.policy';

@Injectable()
export class AdminRoleService implements OnModuleInit {
	private readonly logger = new Logger(AdminRoleService.name);

	constructor(
		@InjectModel('User') private readonly userModel: Model<User>,
		@InjectModel('RoleChangeAudit')
		private readonly roleChangeAuditModel: Model<RoleChangeAudit>
	) {}

	async onModuleInit() {
		await this.ensureBootstrapAdmin();
	}

	async ensureBootstrapAdmin() {
		const email = bootstrapAdminEmail();
		const user = await this.userModel.findOne({ email });
		if (!user || user.role === Role.Admin) return;

		if (!canBootstrapAdmin(user)) {
			this.logger.warn(
				`Conta ${email} existe sem e-mail verificado: promoção a admin ignorada`
			);
			return;
		}

		const previousRole = user.role;
		user.role = Role.Admin;
		await user.save();
		await this.recordChange(user, previousRole, {
			performedByEmail: ROLE_CHANGE_BOOTSTRAP_ACTOR,
		});
		this.logger.log(`Role admin garantida para ${email}`);
	}

	async updateUserRoleByEmail(adminUserId: string, email: string, role: Role) {
		const normalizedEmail = email.trim().toLowerCase();
		if (![Role.Admin, Role.Editor].includes(role)) {
			throw new BadRequestException(
				'Apenas roles admin e editor podem ser atribuídas no painel'
			);
		}

		const [user, actor] = await Promise.all([
			this.userModel.findOne({ email: normalizedEmail }),
			this.userModel.findById(adminUserId),
		]);
		if (!user) {
			throw new NotFoundException('Usuário não encontrado');
		}
		if (!actor) {
			throw new NotFoundException('Usuário executor não encontrado');
		}

		const previousRole = user.role;
		user.role = role;
		await user.save();

		await this.recordChange(user, previousRole, {
			performedBy: actor._id,
			performedByEmail: actor.email,
		});
		this.logger.log(
			`Role de ${user.email} alterada de ${previousRole} para ${role} por ${actor.email}`
		);

		return {
			message: 'Role atualizada com sucesso',
			user: {
				id: String(user._id),
				email: user.email,
				role: user.role,
			},
		};
	}

	private recordChange(
		user: User,
		previousRole: Role,
		actor: { performedBy?: unknown; performedByEmail: string }
	) {
		return this.roleChangeAuditModel.create({
			user: user._id,
			userEmail: user.email,
			previousRole,
			newRole: user.role,
			performedBy: actor.performedBy,
			performedByEmail: actor.performedByEmail,
		});
	}
}
