import { Module } from '@nestjs/common';
import { CulturasController } from './culturas.controller.js';
import { CulturasService } from './culturas.service.js';

@Module({
  controllers: [CulturasController],
  providers: [CulturasService],
})
export class CulturasModule {}
