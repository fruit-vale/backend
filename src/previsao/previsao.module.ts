import { Module } from '@nestjs/common';
import { PrecoController } from './preco.controller.js';
import { PrecoService } from './preco.service.js';
import { PrevisaoController } from './previsao.controller.js';
import { PrevisaoService } from './previsao.service.js';

@Module({
  controllers: [PrevisaoController, PrecoController],
  providers: [PrevisaoService, PrecoService],
})
export class PrevisaoModule {}
