import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TokenBlacklistDocument = TokenBlacklist & Document;

@Schema()
export class TokenBlacklist {
	@Prop({ required: true, unique: true })
	token: string;

	@Prop({ required: true })
	expiresAt: Date;

	@Prop({ default: Date.now })
	createdAt: Date;
}

export const TokenBlacklistSchema =
	SchemaFactory.createForClass(TokenBlacklist);
