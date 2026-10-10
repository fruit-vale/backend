import { Module } from '@nestjs/common';
import { PrevisaoController } from './previsao.controller.js';
import { PrevisaoService } from './previsao.service.js';

@Module({
  controllers: [PrevisaoController],
  providers: [PrevisaoService],
})
export class PrevisaoModule {}
