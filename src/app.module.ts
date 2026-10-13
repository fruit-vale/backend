import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { CulturasModule } from './culturas/culturas.module.js';
import { EmpresasModule } from './empresas/empresas.module.js';
import { LeiturasModule } from './leituras/leituras.module.js';
import { LotesModule } from './lotes/lotes.module.js';
import { MqttModule } from './mqtt/mqtt.module.js';
import { PainelModule } from './painel/painel.module.js';
import { PrevisaoModule } from './previsao/previsao.module.js';
import { AlertasModule } from './alertas/alertas.module.js';
import { MercadoModule } from './mercado/mercado.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { PropriedadesModule } from './propriedades/propriedades.module.js';
import { RedisModule } from './redis/redis.module.js';
import { SensoresModule } from './sensores/sensores.module.js';
import { UsuariosModule } from './usuarios/usuarios.module.js';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    AuthModule,
    EmpresasModule,
    UsuariosModule,
    MqttModule,
    SensoresModule,
    LeiturasModule,
    CulturasModule,
    LotesModule,
    PropriedadesModule,
    PainelModule,
    PrevisaoModule,
    AlertasModule,
    MercadoModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
