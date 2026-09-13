import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { UsersService } from './users.service';
import { MongooseModule } from '@nestjs/mongoose';
import { UserModel } from './schema/user.model';
import { EmailModule } from 'src/notifications/email/email.module';
import { PasswordSecurityService } from 'src/authentication/security/password-security.service';
import { RAG_ERASURE } from 'src/users/application/rag-erasure.port';
import { TrackerrIaRagErasureAdapter } from 'src/users/infrastructure/trackerr-ia-rag-erasure.adapter';
import { BreachedPasswordModule } from 'src/authentication/breached-password.module';

@Module({
	imports: [
		MongooseModule.forFeature([{ name: 'User', schema: UserModel.schema }]),
		EmailModule,
		HttpModule,
		// Modulo folha (TRK-012): nao importa o UsersModule de volta, entao
		// nao ha ciclo nem forwardRef.
		BreachedPasswordModule,
	],
	providers: [
		UsersService,
		PasswordSecurityService,
		{
			provide: RAG_ERASURE,
			useClass: TrackerrIaRagErasureAdapter,
		},
	],
	exports: [UsersService, MongooseModule],
})
export class UsersModule {}
