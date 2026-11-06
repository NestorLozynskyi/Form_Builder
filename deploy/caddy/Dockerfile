# syntax=docker/dockerfile:1
# Builds the Angular SPA and serves it with Caddy (which also proxies /api to the backend).
FROM node:24-alpine AS build
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json frontend/.npmrc ./
RUN npm ci --include=dev --no-audit --no-fund
COPY frontend/ ./
RUN npx ng build --configuration production

FROM caddy:2-alpine
COPY deploy/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/dist/frontend/browser /srv
