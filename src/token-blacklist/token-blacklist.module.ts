import { DynamicModule, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TokenBlacklistService } from './token-blacklist.service';
import {
	TokenBlacklist,
	TokenBlacklistSchema,
} from './schema/token-blacklist.schema';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: TokenBlacklist.name, schema: TokenBlacklistSchema },
		]),
	],
	providers: [TokenBlacklistService],
	exports: [TokenBlacklistService],
})
export class TokenBlacklistModule {
	static forRoot(): DynamicModule {
		return {
			module: TokenBlacklistModule,
			global: true, // Torna o módulo global
		};
	}
}
