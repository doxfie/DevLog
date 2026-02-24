# bookworm-slim = glibc → better-sqlite3 подтягивает пресобранный бинарник, без компиляции
FROM node:20-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js db.js ./
COPY public ./public
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV DB_PATH=/app/data/devlog.db

EXPOSE 3000

CMD ["node", "--env-file=.env", "server.js"]
