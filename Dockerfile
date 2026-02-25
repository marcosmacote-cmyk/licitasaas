FROM node:20-alpine
WORKDIR /app/server

# Copy backend package and install production deps
COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev

# Generate Prisma client
COPY server/prisma ./prisma
RUN npx prisma generate

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
