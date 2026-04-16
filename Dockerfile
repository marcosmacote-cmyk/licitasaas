FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache openssl

# Build Backend
WORKDIR /app/backend
COPY server/package.json server/package-lock.json* ./
COPY server/prisma ./prisma
RUN npm install
COPY server/ ./
RUN npx prisma generate
RUN npx tsc

# Build Frontend
WORKDIR /app/frontend
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
ARG CACHE_BUST=1
RUN npm run build

# Final Stage
FROM node:20-alpine
WORKDIR /app/server
RUN apk add --no-cache openssl postgresql16-client

COPY --from=builder /app/backend/package.json ./
COPY --from=builder /app/backend/node_modules ./node_modules
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/backend/prisma ./prisma
COPY --from=builder /app/frontend/dist ./public

RUN mkdir -p uploads

ENV NODE_ENV=production
ENV PORT=3001
ENV PROCESS_ROLE=all
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["sh", "-c", "npx prisma db push --accept-data-loss && if [ -f prisma/migrations/20260416190000_add_fts_search_vector/migration.sql ]; then echo '[Docker] Running FTS migration...' && PGPASSWORD=$(echo $DATABASE_URL | sed 's/.*:\\/\\/[^:]*:\\([^@]*\\)@.*/\\1/') psql $(echo $DATABASE_URL | sed 's/\\?.*//') -f prisma/migrations/20260416190000_add_fts_search_vector/migration.sql 2>&1 || echo '[Docker] FTS migration warning (may already exist)'; fi && if [ \"$PROCESS_ROLE\" = \"worker\" ]; then echo '[Docker] Starting WORKER process...' && node dist/worker.js; else echo '[Docker] Starting API process...' && node dist/index.js; fi"]
