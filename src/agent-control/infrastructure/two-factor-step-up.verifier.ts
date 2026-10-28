import { Injectable } from '@nestjs/common';
import { StepUpVerifier } from 'src/agent-control/application/ports/agent-control-side-effects.port';
import { TwoFactorService } from 'src/two-factor/two-factor.service';

/** Reautenticação pelo 2FA que já existe (TOTP e contagem de tentativas). */
@Injectable()
export class TwoFactorStepUpVerifier implements StepUpVerifier {
	constructor(private readonly twoFactor: TwoFactorService) {}

	verify(userId: string, code: string): Promise<void> {
		return this.twoFactor.verifyStepUpCode(userId, code);
	}
}
