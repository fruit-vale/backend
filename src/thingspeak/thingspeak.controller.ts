import {
  Controller,
  DefaultValuePipe,
  Get,
  NotFoundException,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { ThingspeakService } from './thingspeak.service.js';

const MAX_LIMIT = 100;

@Controller('thingspeak')
export class ThingspeakController {
  constructor(private readonly thingspeak: ThingspeakService) {}

  @Get()
  async leituras(
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    const resultado = await this.thingspeak.ultimasLeituras(
      Math.min(Math.max(limit, 1), MAX_LIMIT),
    );
    if (!resultado)
      throw new NotFoundException('Sensor não configurado ou não cadastrado.');
    return resultado;
  }
}
