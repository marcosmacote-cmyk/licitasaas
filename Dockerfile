# ── Stage 1: Build Everything ──
FROM node:20-alpine AS builder
WORKDIR /app

# Build Frontend
COPY package.json package-lock.json* ./
RUN npm install --ignore-scripts
COPY . .
ENV NODE_OPTIONS="--max-old-space-size=512"
RUN npm run build

# Build Backend
WORKDIR /app/server
COPY server/package.json server/package-lock.json* ./
RUN npm install
RUN npx prisma generate && npx tsc

# ── Stage 2: Production ──
FROM node:20-alpine
WORKDIR /app/server

# Install production deps
COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev && npx prisma generate

# Copy compiled backend
COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/server/prisma ./prisma

# Copy Prisma client
COPY --from=builder /app/server/node_modules/.prisma ./node_modules/.prisma

# Copy built frontend into public/
COPY --from=builder /app/dist ./public

# Create uploads directory
RUN mkdir -p uploads

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

CMD ["node", "dist/index.js"]
