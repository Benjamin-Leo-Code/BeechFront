# Built locally by the Home Assistant Supervisor from this folder.

# 1. Build the front end (glibc image – Vite's native bindings are happiest here)
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY vite.config.js ./
COPY web ./web
RUN npx vite build

# 2. Small runtime image – the server is plain JavaScript
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY --from=build /app/web/dist ./web/dist
CMD ["node", "server/index.js"]
