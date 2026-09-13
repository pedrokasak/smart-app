import {
	All,
	Controller,
	Req,
	Res,
	ServiceUnavailableException,
	UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Role } from 'src/auth/enums/role.enum';
import {
	BULL_BOARD_BASE_PATH,
	BullBoardService,
} from 'src/events/admin/bull-board.service';

/**
 * Painel da fila de eventos (TRA-136, fase 2).
 *
 * Protegido pelo MESMO estilo de guarda do `GET /admin/notifications`:
 * JwtAuthGuard global + RolesGuard com @Roles(Role.Admin). A bull-board e
 * montada como rota do Nest, e nao com `app.use()` no `main.ts`, justamente
 * para que ela passe pelo pipeline de autenticacao em vez de ficar ao lado
 * dele — um painel que lista payload de evento de usuario nao pode depender
 * de "ninguem sabe a URL".
 *
 * `readOnlyMode` esta ligado no service: o painel inspeciona, nao reprocessa.
 * Repique manual de job (e a rota de escrita correspondente) fica para uma
 * fase posterior, com auditoria.
 *
 * Consequencia conhecida: por exigir `Authorization: Bearer`, a UI nao abre
 * numa navegacao direta do browser — precisa de um cliente que injete o
 * header. Trocar isso por sessao com cookie e follow-up; degradar a guarda
 * para "sem token" nao e opcao.
 */
@Controller('admin/queues')
@ApiExcludeController()
@ApiBearerAuth('access-token')
@UseGuards(RolesGuard)
export class BullBoardController {
	constructor(private readonly board: BullBoardService) {}

	@All()
	@Roles(Role.Admin)
	async root(@Req() req: Request, @Res() res: Response): Promise<void> {
		this.forward(req, res);
	}

	@All('*')
	@Roles(Role.Admin)
	async proxy(@Req() req: Request, @Res() res: Response): Promise<void> {
		this.forward(req, res);
	}

	private forward(req: Request, res: Response): void {
		const handler = this.board.handler();
		if (!handler) {
			throw new ServiceUnavailableException(
				'Fila de eventos desligada (EVENTS_QUEUE_ENABLED=false)'
			);
		}

		// O router da bull-board foi escrito para ser montado com
		// `app.use(basePath, router)`, que entrega `req.url` ja sem o prefixo.
		// Como aqui ele e chamado de dentro de um handler do Nest, o prefixo
		// precisa ser removido na mao.
		req.url = req.originalUrl.slice(BULL_BOARD_BASE_PATH.length) || '/';

		handler(req, res, () => {
			if (!res.headersSent) res.status(404).end();
		});
	}
}
