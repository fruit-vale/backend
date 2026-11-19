import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators.js';
import { PropriedadesService } from './propriedades.service.js';

/**
 * Mapa público: nome, local, contorno e empresa de cada propriedade. Não
 * expõe lotes, sensores, área cultivada nem responsável.
 */
@Public()
@Controller('publico/propriedades')
export class PropriedadesPublicasController {
  constructor(private readonly propriedades: PropriedadesService) {}

  @Get()
  listar() {
    return this.propriedades.listarPublicas();
  }
}
