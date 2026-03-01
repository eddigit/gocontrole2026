# Stage 1: Build backend
FROM node:20-alpine AS backend-builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --ignore-scripts
RUN npx prisma --version || true

COPY tsconfig.json ./
COPY prisma ./prisma/
RUN npx prisma generate

COPY src ./src/
RUN npx tsc

# Stage 2: Build frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/client

COPY client/package.json client/package-lock.json* ./
RUN npm install

COPY client/ ./
RUN npm run build

# Stage 3: Production runner
FROM node:20-alpine AS runner

WORKDIR /app

COPY --from=backend-builder /app/package.json ./
COPY --from=backend-builder /app/node_modules ./node_modules/
COPY --from=backend-builder /app/dist ./dist/
COPY --from=backend-builder /app/prisma ./prisma/

# Copy frontend build to dist/client (where Fastify serves it)
COPY --from=frontend-builder /app/client/dist ./dist/client/

ENV NODE_ENV=production

EXPOSE 3000

CMD ["sh", "-c", "npx prisma db push --skip-generate --accept-data-loss && node dist/index.js"]
