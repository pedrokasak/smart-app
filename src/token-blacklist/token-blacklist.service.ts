import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
	TokenBlacklist,
	TokenBlacklistDocument,
} from './schema/token-blacklist.schema';

@Injectable()
export class TokenBlacklistService {
	constructor(
		@InjectModel(TokenBlacklist.name)
		private tokenBlacklistModel: Model<TokenBlacklistDocument>
	) {}

	async addToBlacklist(token: string, expiresAt: number): Promise<void> {
		await this.tokenBlacklistModel.create({
			token: token,
			expiresAt: new Date(expiresAt * 1000),
		});
	}

	async isBlacklisted(token: string): Promise<boolean> {
		const blacklistedToken = await this.tokenBlacklistModel
			.findOne({ token })
			.exec();
		return !!blacklistedToken;
	}

	// Método para limpar tokens expirados da blacklist (pode ser executado periodicamente)
	async cleanupExpiredTokens(): Promise<void> {
		await this.tokenBlacklistModel
			.deleteMany({ expiresAt: { $lt: new Date() } })
			.exec();
	}
}
