# syntax = docker/dockerfile:1
ARG NODE_VERSION=20.18.0
FROM node:${NODE_VERSION}-alpine AS base

WORKDIR /app

# ---------------- STAGE DE BUILD ----------------
FROM base AS build

# Dependências de compilação
RUN apk add --no-cache python3 make g++ openssl

# Não defina NODE_ENV=production aqui para incluir devDependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copiar código e buildar
COPY . .
RUN npm run build

# ---------------- STAGE FINAL ----------------
FROM base

# Agora sim, produção
ENV NODE_ENV=production

# Instalar apenas prod
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copiar artefatos do build
COPY --from=build /app/dist ./dist

# Usuário e porta
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]