FROM node:20-alpine
WORKDIR /app/server

# Copy package files AND prisma schema (needed for postinstall)
COPY server/package.json server/package-lock.json* ./
COPY server/prisma ./prisma

# Install production deps (postinstall runs prisma generate)
RUN npm install --omit=dev

# Copy pre-built backend
COPY server/dist ./dist

# Copy pre-built frontend
COPY server/public ./public

# Create uploads directory
RUN mkdir -p uploads

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

CMD ["node", "dist/index.js"]
