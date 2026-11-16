FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8484 \
    BEECHFRONT_CONFIG=/config/config.yaml \
    BEECHFRONT_DATA=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY config/config.example.yaml ./config.example.yaml
COPY --from=build /app/web/dist ./web/dist
EXPOSE 8484
VOLUME ["/config", "/data"]
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8484/api/session >/dev/null || exit 1
CMD ["node", "server/index.js"]
