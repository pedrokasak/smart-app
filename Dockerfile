# syntax = docker/dockerfile:1

ARG NODE_VERSION=20.18.0
FROM node:${NODE_VERSION}-alpine AS base

WORKDIR /app
ENV NODE_ENV="production"

# ---------------- STAGE DE BUILD ----------------
FROM base AS build

RUN apk add --no-cache python3 make g++ openssl
# RUN corepack enable && corepack prepare yarn@4.5.0 --activate


# COPY .yarnrc.yml package.json yarn.lock ./

RUN npm install

# Copiar configurações do npm
COPY package.json ./

COPY . .
RUN npm build

# ---------------- STAGE FINAL ----------------
FROM base

# RUN corepack enable && corepack prepare yarn@4.5.0 --activate


# COPY .yarn ./.yarn
# COPY .yarnrc.yml package.json yarn.lock ./

RUN npm install

# Copiar configurações do npm
COPY package.json ./

COPY --from=build /app/dist ./dist

USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
