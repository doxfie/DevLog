FROM node:20-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-alpine

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY package.json server.js db.js ./
COPY public ./public

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV DB_PATH=/app/data/devlog.db

EXPOSE 3000

CMD ["node", "--env-file=.env", "server.js"]
