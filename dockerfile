FROM node:24-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
COPY src ./src
COPY tsconfig*.json ./
COPY nest-cli.json ./
COPY prisma7.config.ts ./

RUN npx prisma generate
RUN npm run build

FROM node:24-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/generated ./src/generated
COPY --from=builder /app/prisma ./prisma
COPY prisma7.config.ts ./
COPY scripts/migrar.mjs scripts/criar-admin.mjs scripts/seed-empresas.mjs ./scripts/

EXPOSE 3000
# aplica as migrations (cria o schema se o banco estiver vazio) e sobe a API
CMD ["sh", "-c", "node scripts/migrar.mjs && node dist/main.js"]