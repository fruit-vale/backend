import type { Prisma } from '../generated/prisma/client.js';
import type { JwtPayload } from './decorators.js';

/**
 * Propriedades visíveis para o usuário:
 * - administrador: todas
 * - analista: todas da própria empresa
 * - produtor: só aquelas em que é o responsável, dentro da própria empresa
 */
export function escopoPropriedades(
  user: JwtPayload,
): Prisma.propriedadesWhereInput {
  switch (user.role) {
    case 'administrador':
      return {};
    case 'analista':
      return { empresa_id: user.empresa_id ?? -1 };
    case 'produtor':
      return {
        empresa_id: user.empresa_id ?? -1,
        produtor_responsavel_id: user.sub,
      };
  }
}

export function escopoLotes(user: JwtPayload): Prisma.lotesWhereInput {
  return { propriedades: escopoPropriedades(user) };
}

export function escopoSensores(user: JwtPayload): Prisma.sensoresWhereInput {
  return { propriedades: escopoPropriedades(user) };
}

export function escopoAlertas(
  user: JwtPayload,
): Prisma.alertas_climaticosWhereInput {
  return { lotes: escopoLotes(user) };
}
