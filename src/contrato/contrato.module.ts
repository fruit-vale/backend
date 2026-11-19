import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module.js';
import { ContratoController } from './contrato.controller.js';
import { ContratoService } from './contrato.service.js';

@Module({
  imports: [EmailModule],
  controllers: [ContratoController],
  providers: [ContratoService],
  exports: [ContratoService],
})
export class ContratoModule {}
