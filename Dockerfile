# syntax = docker/dockerfile:1
FROM oven/bun:1-alpine AS base

WORKDIR /app

# ---------------- STAGE DE BUILD ----------------
FROM base AS build

# Dependências de compilação
RUN apk add --no-cache python3 make g++ openssl

# Não defina NODE_ENV=production aqui para incluir devDependencies. Copiar todo o código.
COPY . .
RUN bun install

# Buildar
RUN bun run build

# ---------------- STAGE FINAL ----------------
FROM base

# Agora sim, produção
ENV NODE_ENV=production
ENV NODE_PATH=./dist

# Instalar apenas prod
COPY package.json ./
COPY bun.lock ./

RUN bun install --production

# Copiar artefatos do build
COPY --from=build /app/dist ./dist

# Usuário e porta
USER bun
EXPOSE 3000
CMD ["bun", "run", "--require", "tsconfig-paths/register", "dist/src/main.js"]
