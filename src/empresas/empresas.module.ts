import { Module } from '@nestjs/common';
import { ContratoModule } from '../contrato/contrato.module.js';
import { MqttModule } from '../mqtt/mqtt.module.js';
import { EmpresasController } from './empresas.controller.js';
import { EmpresasPublicasController } from './empresas-publicas.controller.js';
import { EmpresasService } from './empresas.service.js';

@Module({
  imports: [ContratoModule, MqttModule],
  controllers: [EmpresasController, EmpresasPublicasController],
  providers: [EmpresasService],
})
export class EmpresasModule {}
