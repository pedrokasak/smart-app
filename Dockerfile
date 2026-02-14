FROM oven/bun:1-alpine AS base
WORKDIR /app

# -------- BUILD --------
FROM base AS build
RUN apk add --no-cache python3 make g++ openssl

COPY . .
RUN bun install
RUN bun run build

# -------- PRODUCTION --------
FROM base

ENV NODE_ENV=production

COPY --from=build /app ./

USER bun
EXPOSE 3000

CMD ["bun", "dist/main.js"]
