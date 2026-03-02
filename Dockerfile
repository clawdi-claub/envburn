FROM node:20-alpine AS builder

WORKDIR /app

COPY api/package*.json ./api/
RUN cd api && npm ci --only=production

COPY api/src ./api/src/
COPY web ./web/

FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache dumb-init
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

COPY --from=builder --chown=nodejs:nodejs /app/api ./
COPY --from=builder --chown=nodejs:nodejs /app/web ../web/

RUN mkdir -p /app/data && chown -R nodejs:nodejs /app/data

USER nodejs
EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/envburn.db

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>r.ok?process.exit(0):process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/index.js"]
