// Aplica as migrations do Prisma antes de a API subir.
// Banco já existente (criado antes das migrations, sem _prisma_migrations):
// marca a baseline como aplicada em vez de recriar as tabelas.
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const BASELINE = '0_init';

function prisma(...args) {
  const r = spawnSync('npx', ['prisma', ...args, '--config', 'prisma7.config.ts'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const { rows } = await client.query(
  `SELECT to_regclass('public._prisma_migrations') AS mig,
          to_regclass('public.usuarios') AS usuarios`,
);
await client.end();

if (!rows[0].mig && rows[0].usuarios) {
  console.log(`[migrar] banco existente sem histórico: baseline ${BASELINE} marcada como aplicada`);
  prisma('migrate', 'resolve', '--applied', BASELINE);
}

prisma('migrate', 'deploy');
