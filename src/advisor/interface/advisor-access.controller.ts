import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpStatus,
	Param,
	ParseUUIDPipe,
	Post,
	Put,
	Query,
	Req,
	UseGuards,
	UseInterceptors,
} from '@nestjs/common';
import {
	ApiBearerAuth,
	ApiOperation,
	ApiResponse,
	ApiTags,
} from '@nestjs/swagger';
import { OwnershipChecked } from 'src/auth/decorators/ownership.decorator';
import { requesterIdOf } from 'src/auth/ownership';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { ConsentService } from '../application/consent.service';
import { AcceptInviteDto, InviteTokenDto } from './dto/accept-invite.dto';
import {
	AccessGrantResponseDto,
	InvitePreviewResponseDto,
} from './dto/advisor-access-response.dto';
import { ChangeSharedPortfoliosDto } from './dto/change-shared-portfolios.dto';
import { NoStoreInterceptor } from './no-store.interceptor';

/**
 * Investor side of the advisor link. Only translates HTTP: the user comes
 * from the JWT (`requesterIdOf`), never from body, query or route; every
 * rule lives in `ConsentService`.
 */
@Controller('me/advisor-access')
@ApiTags('advisor-access')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class AdvisorAccessController {
	constructor(private readonly consents: ConsentService) {}

	/** The e-mail link opens this: the token must not be cached nor leak. */
	@Get('invites/preview')
	@UseInterceptors(NoStoreInterceptor)
	@ApiOperation({ summary: 'Shows an advisor invite before accepting it' })
	@ApiResponse({ status: 200, type: InvitePreviewResponseDto })
	@ApiResponse({ status: 404, description: 'Invite not found' })
	async preview(
		@Req() req: any,
		@Query() query: InviteTokenDto
	): Promise<InvitePreviewResponseDto> {
		const preview = await this.consents.previewInvite(
			requesterIdOf(req),
			query.token
		);
		return InvitePreviewResponseDto.of(preview);
	}

	@Post('invites/accept')
	@ApiOperation({ summary: 'Accepts an invite sharing the chosen portfolios' })
	@ApiResponse({ status: 201, type: AccessGrantResponseDto })
	@ApiResponse({ status: 404, description: 'Invite not found' })
	@ApiResponse({
		status: 409,
		description: 'Consent text changed (reason CONSENT_TEXT_CHANGED)',
	})
	async accept(
		@Req() req: any,
		@Body() body: AcceptInviteDto
	): Promise<AccessGrantResponseDto> {
		const grant = await this.consents.acceptInvite(
			requesterIdOf(req),
			body.token,
			body.portfolioIds,
			body.consentTextVersion
		);
		return AccessGrantResponseDto.of(grant);
	}

	@Post('invites/decline')
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({ summary: 'Declines an advisor invite' })
	@ApiResponse({ status: 204 })
	@ApiResponse({ status: 404, description: 'Invite not found' })
	async decline(@Req() req: any, @Body() body: InviteTokenDto): Promise<void> {
		await this.consents.declineInvite(requesterIdOf(req), body.token);
	}

	@Get()
	@ApiOperation({ summary: 'Lists who can see my portfolios' })
	@ApiResponse({ status: 200, type: [AccessGrantResponseDto] })
	async list(@Req() req: any): Promise<AccessGrantResponseDto[]> {
		const grants = await this.consents.listMyGrants(requesterIdOf(req));
		return grants.map((grant) => AccessGrantResponseDto.of(grant));
	}

	@Put(':relationshipId/portfolios')
	@OwnershipChecked(
		'ConsentService: active consent of the relationship must be the user'
	)
	@ApiOperation({ summary: 'Changes the portfolios shared with an advisor' })
	@ApiResponse({ status: 200, type: AccessGrantResponseDto })
	@ApiResponse({ status: 404, description: 'Advisory relationship not found' })
	async change(
		@Req() req: any,
		@Param('relationshipId', new ParseUUIDPipe()) relationshipId: string,
		@Body() body: ChangeSharedPortfoliosDto
	): Promise<AccessGrantResponseDto> {
		const grant = await this.consents.changeSharedPortfolios(
			requesterIdOf(req),
			relationshipId,
			body.portfolioIds
		);
		return AccessGrantResponseDto.of(grant);
	}

	@Delete(':relationshipId')
	@OwnershipChecked(
		'ConsentService: active consent of the relationship must be the user'
	)
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({ summary: 'Revokes an advisor access' })
	@ApiResponse({ status: 204 })
	@ApiResponse({ status: 404, description: 'Advisory relationship not found' })
	async revoke(
		@Req() req: any,
		@Param('relationshipId', new ParseUUIDPipe()) relationshipId: string
	): Promise<void> {
		await this.consents.revoke(requesterIdOf(req), relationshipId);
	}
}
