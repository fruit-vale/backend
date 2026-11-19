import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators.js';
import { EmpresasService } from './empresas.service.js';

/** Faixa da landing: apenas o nome das empresas com contrato aceito. */
@Public()
@Controller('publico/empresas')
export class EmpresasPublicasController {
  constructor(private readonly empresas: EmpresasService) {}

  @Get()
  listar() {
    return this.empresas.listarNomesPublicos();
  }
}
