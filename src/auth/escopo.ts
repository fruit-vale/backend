import type { Prisma } from '../generated/prisma/client.js';
import type { JwtPayload } from './decorators.js';

/**
 * Propriedades visíveis para o usuário:
 * - administrador: todas
 * - analista e produtor: todas da própria empresa
 */
export function escopoPropriedades(
  user: JwtPayload,
): Prisma.propriedadesWhereInput {
  switch (user.role) {
    case 'administrador':
      return {};
    case 'analista':
    case 'produtor':
      return { empresa_id: user.empresa_id ?? -1 };
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
