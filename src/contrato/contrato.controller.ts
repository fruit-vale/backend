import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/decorators.js';
import { ContratoService } from './contrato.service.js';

/** IP do cliente; atrás do Traefik vem em X-Forwarded-For. */
function ipDe(req: Request) {
  const encaminhado = req.headers['x-forwarded-for'];
  const primeiro = (
    Array.isArray(encaminhado) ? encaminhado[0] : encaminhado
  )?.split(',')[0];
  return (primeiro ?? req.ip ?? null)?.trim().slice(0, 45) || null;
}

/** Rotas públicas: quem acessa é o responsável da empresa, pelo link do e-mail. */
@Public()
@Controller('contrato')
export class ContratoController {
  constructor(private readonly contrato: ContratoService) {}

  @Get(':token')
  consultar(@Param('token') token: string) {
    return this.contrato.consultar(token);
  }

  @Post(':token/aceitar')
  @HttpCode(200)
  aceitar(
    @Param('token') token: string,
    @Body() body: { nome?: unknown; aceito?: unknown },
    @Req() req: Request,
  ) {
    const nome = typeof body?.nome === 'string' ? body.nome.trim() : '';
    if (body?.aceito !== true)
      throw new BadRequestException('Marque que leu e concorda com o contrato.');
    if (nome.length < 3 || nome.length > 150)
      throw new BadRequestException('Informe seu nome completo.');
    return this.contrato.aceitar(token, nome, ipDe(req));
  }
}
