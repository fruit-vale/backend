import { Module } from '@nestjs/common';
import { LotesController } from './lotes.controller.js';
import { LotesService } from './lotes.service.js';

@Module({
  controllers: [LotesController],
  providers: [LotesService],
})
export class LotesModule {}
