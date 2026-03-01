FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY prisma ./prisma/
RUN npx prisma generate

COPY src ./src/
RUN npx tsc

FROM node:20-alpine AS runner

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules/
COPY --from=builder /app/dist ./dist/
COPY --from=builder /app/prisma ./prisma/

ENV NODE_ENV=production

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
