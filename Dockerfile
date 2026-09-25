FROM oven/bun:1-alpine AS base
WORKDIR /app

# -------- BUILD --------
FROM base AS build
RUN apk add --no-cache python3 make g++ openssl
# O Chrome que o puppeteer baixaria é glibc e não roda no Alpine (musl).
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY . .
# Mesmo lockfile do CI: sem --frozen-lockfile o build resolvia versões na hora.
RUN bun install --frozen-lockfile
RUN bun run build
# A imagem final leva só dependências de produção: ferramenta de build/teste
# (jest, webpack, eslint...) não entra no container nem na superfície de ataque.
RUN rm -rf node_modules && bun install --frozen-lockfile --production

# -------- PRODUCTION --------
FROM base

ENV NODE_ENV=production

# Chromium do Alpine para os relatórios em PDF (puppeteer), com fontes
# para acentos e símbolos.
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont font-noto
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY --from=build /app ./

RUN echo '#!/bin/sh' > /entrypoint.sh && \
    echo 'mkdir -p /app/uploads' >> /entrypoint.sh && \
    echo 'exec bun dist/main.js' >> /entrypoint.sh && \
    chmod +x /entrypoint.sh

# USER bun
EXPOSE 3000

CMD ["/entrypoint.sh"]
# CMD ["bun", "dist/main.js"]
