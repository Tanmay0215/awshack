# Next.js static export served by Caddy (TLS + /api reverse proxy).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Browser key for the Maps JavaScript API (public by design; restrict it by HTTP referrer in Google Cloud).
ARG NEXT_PUBLIC_GOOGLE_MAPS_KEY=""
ENV NEXT_PUBLIC_GOOGLE_MAPS_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_KEY
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /app/out /srv
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443
