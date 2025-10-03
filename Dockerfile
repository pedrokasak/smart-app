# syntax = docker/dockerfile:1

# Ajustar versão do Node
ARG NODE_VERSION=20.18.0
FROM node:${NODE_VERSION}-alpine AS base

LABEL fly_launch_runtime="NestJS"

# Diretório da aplicação
WORKDIR /app

# Definir env de produção
ENV NODE_ENV="production"
ARG YARN_VERSION=1.22.21
RUN npm install -g yarn@$YARN_VERSION --force


# ---------------- STAGE DE BUILD ----------------
FROM base AS build

# Instalar pacotes necessários para build (no Alpine!)
RUN apk add --no-cache python3 make g++ openssl

# Ative Corepack e prepare Yarn 4.5.0
RUN corepack enable && corepack prepare yarn@4.5.0 --activate

# Copiar package.json e lock
COPY package.json yarn.lock ./

# Instalar todas as dependências (incluindo dev)
RUN yarn install --frozen-lockfile

# Copiar código da aplicação
COPY . .

# Build do projeto
RUN yarn build


# ---------------- STAGE FINAL ----------------
FROM base

# Ative Corepack e prepare Yarn 4.5.0
RUN corepack enable && corepack prepare yarn@4.5.0 --activate

# Apenas dependências de produção
COPY package.json yarn.lock ./
RUN yarn install --immutable --production

# Copiar build e node_modules da build stage
COPY --from=build /app/dist ./dist

# Rodar como user não-root
USER node

# Expor porta
EXPOSE 3000

# Comando padrão
CMD ["node", "dist/main.js"]