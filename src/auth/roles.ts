export type Role = 'administrador' | 'produtor' | 'analista';

export const ROLES: Role[] = ['administrador', 'produtor', 'analista'];

// valores aceitos por usuarios_tipo_usuario_check
const TIPO_POR_ROLE: Record<Role, string> = {
  administrador: 'ADMIN',
  produtor: 'PRODUTOR',
  analista: 'ANALISTA',
};

export function toRole(tipoUsuario: string | null): Role | null {
  const tipo = tipoUsuario?.trim().toUpperCase();
  return ROLES.find((role) => TIPO_POR_ROLE[role] === tipo) ?? null;
}

export function toTipoUsuario(role: Role): string {
  return TIPO_POR_ROLE[role];
}

/** Administrador é da plataforma; produtor e analista pertencem a uma empresa. */
export function exigeEmpresa(role: Role) {
  return role !== 'administrador';
}
