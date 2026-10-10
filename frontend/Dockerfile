# Next.js static export served by Caddy (TLS + /api reverse proxy).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /app/out /srv
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443
