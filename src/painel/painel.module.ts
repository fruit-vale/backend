import { Module } from '@nestjs/common';
import { PainelController } from './painel.controller.js';
import { PainelService } from './painel.service.js';

@Module({
  controllers: [PainelController],
  providers: [PainelService],
})
export class PainelModule {}
