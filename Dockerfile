# syntax = docker/dockerfile:1

# Ajustar versão do Node
ARG NODE_VERSION=20.18.0
FROM node:${NODE_VERSION}-alpine AS base

LABEL fly_launch_runtime="NestJS"

# Diretório da aplicação
WORKDIR /app

# Definir env de produção
ENV NODE_ENV="production"

# ---------------- STAGE DE BUILD ----------------
FROM base AS build

# Instalar pacotes necessários para build (no Alpine!)
RUN apk add --no-cache python3 make g++ openssl

# Copiar package.json e yarn.lock
COPY package.json yarn.lock* package-lock.json* ./

# Gerar package-lock.json se não existir e instalar dependências
RUN npm install

# Copiar código da aplicação
COPY . .

# Build do projeto
RUN npm run build

# ---------------- STAGE FINAL ----------------
FROM base

# Copiar package.json
COPY package.json yarn.lock* package-lock.json* ./

# Instalar apenas dependências de produção
RUN npm ci --omit=dev || npm install --omit=dev

# Copiar build da build stage
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules

# Rodar como user não-root
USER node

# Expor porta
EXPOSE 3000

# Comando padrão
CMD ["node", "dist/main.js"]