import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Profile } from 'src/profile/schema/profile.model';
import { EmailOptOutReader } from '../application/ports/email-opt-out.port';

/** Lê a chave geral de e-mail do perfil (TRA-244). */
@Injectable()
export class ProfileEmailOptOutAdapter implements EmailOptOutReader {
	private readonly logger = new Logger(ProfileEmailOptOutAdapter.name);

	constructor(
		@InjectModel('Profile') private readonly profileModel: Model<Profile>
	) {}

	async hasOptedOut(userId: Types.ObjectId): Promise<boolean> {
		try {
			const profile = await this.profileModel
				.findOne({ user: userId })
				.select('preferences.notifications')
				.lean<{ preferences?: { notifications?: boolean } } | null>();
			// Mesmo default da tela (`profile.mapper`): ausente = ligado.
			return profile?.preferences?.notifications === false;
		} catch (err) {
			// Na dúvida, não manda: quem desligou o e-mail não pode recebê-lo
			// porque a leitura da preferência falhou.
			const message = err instanceof Error ? err.message : String(err);
			this.logger.warn(
				`Preferência de e-mail ilegível para ${userId.toString()}; e-mail suprimido: ${message}`
			);
			return true;
		}
	}
}
