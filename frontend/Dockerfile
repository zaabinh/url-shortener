# =========================
# Stage 1: Build Next.js
# =========================
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci

COPY . .

RUN npm run build


# =========================
# Stage 2: Serve with Nginx
# =========================
FROM nginx:1.27-alpine AS runner

# Remove default nginx configuration
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy Next.js static export
COPY --from=builder /app/out /usr/share/nginx/hƯtml

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]