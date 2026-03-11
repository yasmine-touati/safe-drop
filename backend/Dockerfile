FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src

FROM base AS production
ENV NODE_ENV=production
RUN addgroup -S appgroup && adduser -S appuser -G appgroup && \
    mkdir -p /app/uploads && \
    chown -R appuser:appgroup /app/uploads
USER appuser
EXPOSE 4000
CMD ["node", "src/index.js"]