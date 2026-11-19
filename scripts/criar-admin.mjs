// Cria (ou atualiza a senha de) o usuário administrador da plataforma.
// Uso, dentro do container da API:
//   docker exec -it $(docker ps -q -f name=fruitvale_api) node scripts/criar-admin.mjs
// Valores podem ser trocados por ADMIN_EMAIL, ADMIN_SENHA, ADMIN_NOME e ADMIN_CPF.
import bcrypt from 'bcryptjs';
import pg from 'pg';

const email = process.env.ADMIN_EMAIL ?? 'admin@fruitvale.com.br';
const senha = process.env.ADMIN_SENHA ?? 'admin0@';
const nome = process.env.ADMIN_NOME ?? 'Administrador';
const cpf = process.env.ADMIN_CPF ?? '529.982.247-25';

const senhaHash = await bcrypt.hash(senha, 10);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const existente = await client.query(
    'SELECT id FROM usuarios WHERE email = $1',
    [email],
  );

  if (existente.rowCount) {
    await client.query(
      `UPDATE usuarios
          SET senha_hash = $2, tipo_usuario = 'ADMIN', status = 'ATIVO', empresa_id = NULL
        WHERE email = $1`,
      [email, senhaHash],
    );
    console.log(`[criar-admin] ${email} já existia: senha redefinida e perfil ADMIN.`);
  } else {
    await client.query(
      `INSERT INTO usuarios (nome, cpf, email, senha_hash, tipo_usuario, status)
       VALUES ($1, $2, $3, $4, 'ADMIN', 'ATIVO')`,
      [nome, cpf, email, senhaHash],
    );
    console.log(`[criar-admin] administrador ${email} criado.`);
  }
} finally {
  await client.end();
}
