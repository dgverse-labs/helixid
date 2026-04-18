FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY turbo.json ./
COPY helix-core/package*.json ./helix-core/
COPY helix-api/package*.json ./helix-api/
RUN npm ci
COPY helix-core ./helix-core
COPY helix-api ./helix-api
RUN npm run build --workspace=helix-core
RUN npm run build --workspace=helix-api
RUN cd helix-api && npx prisma generate

FROM node:24-alpine AS runner
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/helix-core/dist ./helix-core/dist
COPY --from=builder /app/helix-api/dist ./helix-api/dist
COPY --from=builder /app/helix-api/prisma ./helix-api/prisma
EXPOSE 3000
CMD ["node", "helix-api/dist/server.js"]
