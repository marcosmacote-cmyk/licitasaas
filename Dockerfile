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
RUN npm run build

# Final Stage
FROM node:20-alpine
WORKDIR /app/server
RUN apk add --no-cache openssl

COPY --from=builder /app/backend/package.json ./
COPY --from=builder /app/backend/node_modules ./node_modules
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/backend/prisma ./prisma
COPY --from=builder /app/frontend/dist ./public

RUN mkdir -p uploads

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

CMD ["sh", "-c", "npx prisma db push && node dist/index.js"]
