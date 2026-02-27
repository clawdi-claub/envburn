FROM node:20-alpine

WORKDIR /app

COPY api/package*.json ./api/
RUN cd api && npm ci --omit=dev

COPY api/src ./api/src
COPY web ./web

RUN mkdir -p /app/data

ENV PORT=3000
ENV DB_PATH=/app/data/envburn.db

EXPOSE 3000

CMD ["node", "api/src/index.js"]
