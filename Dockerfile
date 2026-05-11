# Build context must be the xpage/ parent directory:
#   docker build -f admin-service/Dockerfile ..
# (docker-compose handles this automatically via context: ..)

# ── Stage 1: Build React frontend ─────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /frontend

COPY admin-front/package*.json ./
RUN npm ci --prefer-offline

COPY admin-front/ ./
RUN npm run build

# ── Stage 2: Build Go binary ───────────────────────────────────────────────────
FROM golang:1.22-alpine AS go-builder

WORKDIR /app

COPY admin-service/go.mod ./
COPY admin-service/*.go ./

# Embed the built React assets
COPY --from=frontend-builder /frontend/dist ./frontend/dist

RUN go mod tidy && \
    CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o server .

# ── Stage 3: Minimal runtime ───────────────────────────────────────────────────
FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app
COPY --from=go-builder /app/server ./server

EXPOSE 8080
ENTRYPOINT ["./server"]
