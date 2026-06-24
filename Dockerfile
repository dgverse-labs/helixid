FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

COPY helix-api/package.json ./helix-api/

RUN corepack enable && pnpm install --frozen-lockfile

COPY helix-api ./helix-api

RUN pnpm --filter helix-api build

RUN cd helix-api && npx prisma generate


FROM node:24-alpine AS runner

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules

COPY --from=builder /app/helix-api/dist ./helix-api/dist

COPY --from=builder /app/helix-api/prisma ./helix-api/prisma

COPY --from=builder /app/helix-api/package.json ./helix-api/package.json


EXPOSE 3000

CMD ["node","helix-api/dist/server.js"]