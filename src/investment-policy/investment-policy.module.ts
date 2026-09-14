import { Module } from '@nestjs/common';
import { UsersModule } from 'src/users/users.module';
import { InvestmentPolicyController } from './investment-policy.controller';
import { InvestmentPolicyService } from './investment-policy.service';

@Module({
	imports: [UsersModule],
	controllers: [InvestmentPolicyController],
	providers: [InvestmentPolicyService],
	exports: [InvestmentPolicyService],
})
export class InvestmentPolicyModule {}
