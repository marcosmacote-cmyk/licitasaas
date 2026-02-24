# ── Stage 1: Build Frontend ──
FROM node:20-alpine AS frontend-build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ── Stage 2: Build Backend ──
FROM node:20-alpine AS backend-build
WORKDIR /app/server

COPY server/package.json server/package-lock.json* ./
RUN npm ci

COPY server/ .
RUN npx prisma generate && npx tsc

# ── Stage 3: Production ──
FROM node:20-alpine AS production
WORKDIR /app

# Install production deps for backend
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm ci --omit=dev && npx prisma generate

# Copy compiled backend
COPY --from=backend-build /app/server/dist ./server/dist
COPY server/prisma ./server/prisma

# Copy built frontend
COPY --from=frontend-build /app/dist ./server/public

# Copy Prisma client (needed at runtime)
COPY --from=backend-build /app/server/node_modules/.prisma ./server/node_modules/.prisma

# Create uploads directory
RUN mkdir -p ./server/uploads

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

WORKDIR /app/server
CMD ["node", "dist/index.js"]
