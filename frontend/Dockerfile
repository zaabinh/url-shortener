FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
ENV NEXT_PUBLIC_USE_MOCK_API=false
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine

USER 101:101

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/out /usr/share/nginx/html

EXPOSE 8080