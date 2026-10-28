import { Injectable, Logger } from '@nestjs/common';
import { Role } from 'src/auth/enums/role.enum';
import {
	AgentChangeNotifier,
	AgentControlChangedNotice,
} from 'src/agent-control/application/ports/agent-control-side-effects.port';
import { EmailService } from 'src/notifications/email/email.service';
import { UserModel } from 'src/users/schema/user.model';

/**
 * E-mail aos outros admins a cada mudança (decisão de 26/10/2026). Quem fez
 * a mudança não recebe: já sabe. Falha de um destinatário não impede os
 * outros.
 */
@Injectable()
export class EmailAgentChangeNotifier implements AgentChangeNotifier {
	private readonly logger = new Logger(EmailAgentChangeNotifier.name);

	constructor(private readonly email: EmailService) {}

	async notify(notice: AgentControlChangedNotice): Promise<void> {
		const admins = await UserModel.find({ role: Role.Admin })
			.select('_id email')
			.lean<{ _id: unknown; email: string }[]>()
			.exec();

		const actor = admins.find(
			(admin) => String(admin._id) === notice.actorUserId
		);
		const recipients = admins.filter(
			(admin) => String(admin._id) !== notice.actorUserId && admin.email
		);

		const results = await Promise.allSettled(
			recipients.map((admin) =>
				this.email.sendAgentControlChangedNotice({
					to: admin.email,
					agentName: notice.agentName,
					change: notice.change,
					reason: notice.reason,
					actorEmail: actor?.email ?? null,
					at: notice.at,
				})
			)
		);
		const failures = results.filter(
			(result) => result.status === 'rejected'
		).length;
		if (failures) {
			this.logger.warn(
				`Aviso de agente alterado: ${failures}/${recipients.length} e-mail(s) falharam.`
			);
		}
	}
}
