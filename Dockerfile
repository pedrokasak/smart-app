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

RUN echo '#!/bin/sh' > /entrypoint.sh && \
    echo 'mkdir -p /app/uploads' >> /entrypoint.sh && \
    echo 'exec bun dist/main.js' >> /entrypoint.sh && \
    chmod +x /entrypoint.sh

# USER bun
EXPOSE 3000

CMD ["/entrypoint.sh"]
# CMD ["bun", "dist/main.js"]
