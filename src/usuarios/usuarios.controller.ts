import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
} from '@nestjs/common';
import { Roles } from '../auth/decorators.js';
import { ROLES, type Role } from '../auth/roles.js';
import { UsuariosService } from './usuarios.service.js';

@Controller('usuarios')
@Roles('administrador')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get()
  listar() {
    return this.usuarios.listar();
  }

  @Patch(':id/perfil')
  alterarPerfil(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { role?: unknown },
  ) {
    if (!ROLES.includes(body?.role as Role))
      throw new BadRequestException(
        `Perfil inválido. Use: ${ROLES.join(', ')}.`,
      );
    return this.usuarios.alterarPerfil(id, body.role as Role);
  }
}
