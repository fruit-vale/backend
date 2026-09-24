# FruitVale API

API da plataforma FruitVale, que monitora propriedades de fruticultura (lotes, culturas, sensores IoT e alertas) e apoia decisões de colheita e exportação.

Stack: [NestJS 12](https://nestjs.com) · [Prisma 7](https://www.prisma.io) com PostgreSQL (Supabase) · autenticação JWT.

Frontend: [fruit-vale/frontend](https://github.com/fruit-vale/frontend) (React + Vite), publicado no Firebase Hosting.

---

## Sumário

- [Como rodar](#como-rodar)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Módulos](#módulos)
- [Autenticação e perfis](#autenticação-e-perfis)
- [Rotas](#rotas)
- [Erros](#erros)
- [Banco de dados](#banco-de-dados)
- [Deploy](#deploy)

---

## Como rodar

Requisitos: Node.js 24+ e acesso a um banco PostgreSQL.

```bash
npm install
cp .env.example .env      # preencha DATABASE_URL e JWT_SECRET
npx prisma generate       # gera o client em src/generated/prisma
npm run start:dev         # http://localhost:3000
```

| Script | O que faz |
|---|---|
| `npm run start:dev` | Sobe a API em modo watch |
| `npm run build` | Compila para `dist/` |
| `npm run start:prod` | Roda a versão compilada |
| `npm run lint` | Lint com oxlint |
| `npm run format` | Formata com Prettier |

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DATABASE_URL` | sim | Connection string do PostgreSQL (Supabase → Project Settings → Database) |
| `JWT_SECRET` | sim | Segredo que assina os tokens. A API não sobe sem ele. Gere com `openssl rand -base64 48` |
| `JWT_EXPIRES_IN` | não | Validade do token (padrão `8h`) |
| `CORS_ORIGINS` | não | Origens do frontend liberadas, separadas por vírgula |
| `PORT` | não | Porta HTTP (padrão `3000`) |

Nunca versione valores reais de `JWT_SECRET` ou `DATABASE_URL`: quem tiver o segredo consegue emitir tokens de qualquer perfil, inclusive administrador.

## Módulos

```
src/
├── auth/          login, token JWT, guard global, perfis e escopo de dados
├── usuarios/      cadastro e gestão de usuários (administrador)
├── empresas/      cadastro de empresas clientes (administrador)
├── common/        validações compartilhadas (texto, e-mail, CPF, CNPJ)
├── prisma/        PrismaService global (conexão com o banco)
└── generated/     client do Prisma (gerado, fora do git)
```

| Módulo | Responsabilidade |
|---|---|
| **Auth** | `POST /auth/login` e `GET /auth/me`. Registra o `AuthGuard` como guard global: toda rota exige token, exceto as marcadas com `@Public()`. Também exporta os decorators `@Roles()` e `@CurrentUser()` e os filtros de escopo em `escopo.ts`. |
| **Usuarios** | Lista, cria e altera usuários. Garante as regras de vínculo entre perfil e empresa. |
| **Empresas** | Lista e cria empresas. Valida CNPJ (inclusive o alfanumérico) e UF. |
| **Prisma** | Módulo global que expõe o `PrismaService` para os demais. |

## Autenticação e perfis

### Fluxo

1. O cliente envia e-mail e senha para `POST /auth/login`.
2. A API confere a senha (bcrypt) e devolve um `access_token` JWT com validade de 8h.
3. As próximas requisições mandam o header `Authorization: Bearer <access_token>`.
4. O `AuthGuard` valida o token e, se a rota tiver `@Roles(...)`, confere o perfil. Sem token ou com token inválido a resposta é **401**; com perfil sem permissão, **403**.

O token carrega `sub` (id do usuário), `email`, `role` e `empresa_id`. Mudanças de perfil ou empresa feitas pelo administrador só valem no próximo login do usuário.

### Perfis

| Perfil | `tipo_usuario` no banco | Empresa | Quem é |
|---|---|---|---|
| `administrador` | `ADMIN` | nenhuma (é da plataforma) | Gestor da plataforma. Acesso total e único que gerencia usuários e empresas |
| `produtor` | `PRODUTOR` | obrigatória | Dono ou gestor da propriedade rural |
| `analista` | `ANALISTA` | obrigatória | Time técnico, logístico ou de mercado da empresa |

Um usuário só consegue fazer login se estiver com status `ATIVO`, tiver um perfil válido e, no caso de produtor ou analista, estiver vinculado a uma empresa.

### Escopo de dados

A empresa é o cliente da plataforma. `src/auth/escopo.ts` monta os filtros do Prisma que limitam o que cada perfil enxerga, e os endpoints de dados devem aplicá-los:

| Perfil | Propriedades visíveis |
|---|---|
| `administrador` | Todas |
| `analista` | Todas da própria empresa (leitura) |
| `produtor` | Só as da própria empresa em que é o `produtor_responsavel_id` |

Os filtros disponíveis são `escopoPropriedades`, `escopoLotes`, `escopoSensores` e `escopoAlertas`. Eles derivam todos do escopo de propriedades.

```ts
@Get()
listar(@CurrentUser() user: JwtPayload) {
  return this.prisma.lotes.findMany({ where: escopoLotes(user) });
}
```

### Protegendo rotas

```ts
@Public()                          // libera sem token
@Roles('administrador')            // só administrador
@Roles('administrador', 'analista') // mais de um perfil
```

Sem nenhum decorator, a rota exige apenas um token válido (qualquer perfil).

## Rotas

| Método | Rota | Acesso | Descrição |
|---|---|---|---|
| `GET` | `/` | público | Health check |
| `POST` | `/auth/login` | público | Autentica e devolve o token |
| `GET` | `/auth/me` | autenticado | Dados do usuário logado |
| `GET` | `/usuarios` | administrador | Lista usuários |
| `POST` | `/usuarios` | administrador | Cadastra usuário |
| `PATCH` | `/usuarios/:id` | administrador | Altera perfil e/ou empresa |
| `GET` | `/empresas` | administrador | Lista empresas |
| `POST` | `/empresas` | administrador | Cadastra empresa |

### `POST /auth/login`

```json
{ "email": "admin@fruitvale.com.br", "senha": "••••••••" }
```

Resposta `200`:

```json
{
  "access_token": "eyJhbGciOi...",
  "usuario": {
    "id": 1,
    "nome": "Administrador",
    "email": "admin@fruitvale.com.br",
    "role": "administrador",
    "empresa": null
  }
}
```

- `401 E-mail ou senha inválidos.`: credenciais erradas.
- `401 Acesso não liberado. Fale com o administrador.`: usuário inativo, sem perfil válido ou (produtor/analista) sem empresa.

### `GET /auth/me`

Devolve o mesmo objeto `usuario` do login, lido do banco na hora. O frontend usa essa rota para revalidar o token salvo ao abrir o app.

### `GET /usuarios`

```json
[
  {
    "id": 2,
    "nome": "Produtor",
    "email": "produtor@fruitvale.com.br",
    "cpf": "000.000.000-02",
    "telefone": null,
    "status": "ATIVO",
    "role": "produtor",
    "empresa": { "id": 1, "razao_social": "Empresa Exemplo" }
  }
]
```

### `POST /usuarios`

```json
{
  "nome": "Maria Souza",
  "email": "maria@empresa.com.br",
  "cpf": "123.456.789-01",
  "telefone": "(87) 99999-0000",
  "senha": "senha-inicial",
  "role": "produtor",
  "empresa_id": 1
}
```

| Campo | Regra |
|---|---|
| `nome` | obrigatório, até 100 caracteres |
| `email` | obrigatório, único, salvo em minúsculas |
| `cpf` | obrigatório, único, 11 dígitos com ou sem máscara (salvo formatado) |
| `telefone` | opcional |
| `senha` | obrigatória, mínimo de 8 caracteres (salva com bcrypt) |
| `role` | `administrador`, `produtor` ou `analista` |
| `empresa_id` | obrigatório para produtor e analista, e deve existir. Deve ser `null` para administrador |

Resposta `201` com o usuário no formato de `GET /usuarios`. E-mail ou CPF já cadastrados retornam `409`.

### `PATCH /usuarios/:id`

Altera perfil e/ou empresa. Envie os dois juntos quando a troca de perfil mudar a exigência de empresa (por exemplo, de administrador para produtor):

```json
{ "role": "produtor", "empresa_id": 1 }
```

Valem as mesmas regras de vínculo do cadastro. O administrador não pode alterar o próprio perfil.

### `GET /empresas`

```json
[
  {
    "id": 1,
    "razao_social": "Vale Frutas Ltda",
    "cpf_cnpj": "11.222.333/0001-81",
    "telefone": null,
    "email": "contato@valefrutas.com.br",
    "cidade": "Petrolina",
    "estado": "PE",
    "responsavel": "João Lima",
    "total_usuarios": 3
  }
]
```

### `POST /empresas`

```json
{
  "razao_social": "Vale Frutas Ltda",
  "cpf_cnpj": "11.222.333/0001-81",
  "responsavel": "João Lima",
  "email": "contato@valefrutas.com.br",
  "telefone": "(87) 3000-0000",
  "cidade": "Petrolina",
  "estado": "PE"
}
```

| Campo | Regra |
|---|---|
| `razao_social` | obrigatório, até 150 caracteres |
| `cpf_cnpj` | obrigatório, único. Precisa ser um CNPJ com dígitos verificadores válidos, numérico ou alfanumérico (formato da Receita desde jul/2026, ex.: `12.ABC.345/01DE-35`). Salvo formatado |
| `estado` | opcional, sigla de uma das 27 UFs |
| `cidade`, `responsavel`, `email`, `telefone` | opcionais |

Resposta `201` com a empresa no formato de `GET /empresas`. CNPJ já cadastrado retorna `409`.

No frontend, as listas de estados e cidades vêm da [API de localidades do IBGE](https://servicodados.ibge.gov.br/api/docs/localidades). A API FruitVale valida a UF, mas não confere a cidade.

## Erros

Os erros seguem o formato padrão do NestJS, com mensagens em português prontas para exibir ao usuário:

```json
{ "statusCode": 400, "message": "CNPJ inválido.", "error": "Bad Request" }
```

| Status | Quando |
|---|---|
| `400` | Corpo inválido ou regra de negócio violada |
| `401` | Sem token, token inválido/expirado ou login recusado |
| `403` | Perfil sem acesso à rota |
| `404` | Registro não encontrado |
| `409` | E-mail, CPF ou CNPJ já cadastrado |

## Banco de dados

O schema fica em [`prisma/schema.prisma`](prisma/schema.prisma) e foi introspectado do banco (`prisma db pull`). Depois de alterar o banco, rode `npx prisma db pull` e `npx prisma generate`.

A API espera estas regras na tabela `usuarios`:

```sql
alter table usuarios add constraint usuarios_tipo_usuario_check
  check (tipo_usuario in ('ADMIN', 'PRODUTOR', 'ANALISTA'));

-- só ADMIN pode ficar sem empresa
alter table usuarios add constraint usuarios_empresa_por_perfil_check
  check ((tipo_usuario = 'ADMIN') = (empresa_id is null));
```

### Primeiro administrador

Não existe cadastro público. O primeiro administrador é criado direto no banco (no Supabase, pelo SQL Editor), e os demais usuários são cadastrados por ele na tela de Usuários:

```sql
insert into usuarios (nome, email, cpf, senha_hash, tipo_usuario, status)
values ('Administrador', 'admin@fruitvale.com.br', '000.000.000-01',
        extensions.crypt('SENHA_FORTE', extensions.gen_salt('bf', 10)), 'ADMIN', 'ATIVO');
```

O `crypt` do `pgcrypto` gera um hash bcrypt (`$2a$...`), o mesmo formato que a API confere no login.

## Deploy

A API roda em Docker Swarm atrás do Traefik, em `https://api.fruitvale.com.br` (veja [`stack.yaml`](stack.yaml)).

```bash
docker build -t fruitvale-api:latest -f dockerfile .
docker stack deploy -c stack.yaml fruitvale
```

Antes do deploy, confira no `stack.yaml`:

- `JWT_SECRET` definido (sem ele a API não inicia);
- `CORS_ORIGINS` com o domínio do frontend;
- `DATABASE_URL` apontando para o banco de produção.
