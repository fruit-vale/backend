import { Module } from '@nestjs/common';
import { LotesController } from './lotes.controller.js';
import { LotesService } from './lotes.service.js';
import { SafrasService } from './safras.service.js';

@Module({
  controllers: [LotesController],
  providers: [LotesService, SafrasService],
})
export class LotesModule {}
