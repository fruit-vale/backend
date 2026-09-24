import { Module } from '@nestjs/common';
import { EmpresasController } from './empresas.controller.js';
import { EmpresasService } from './empresas.service.js';

@Module({
  controllers: [EmpresasController],
  providers: [EmpresasService],
})
export class EmpresasModule {}
