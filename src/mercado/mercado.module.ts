import { Module } from '@nestjs/common';
import { MercadoImportacaoService } from './mercado-importacao.service.js';
import { MercadoController } from './mercado.controller.js';
import { MercadoService } from './mercado.service.js';

@Module({
  controllers: [MercadoController],
  providers: [MercadoService, MercadoImportacaoService],
})
export class MercadoModule {}
