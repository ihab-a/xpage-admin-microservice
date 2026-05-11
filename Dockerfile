# ── Stage 1: Build React frontend ─────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /front

COPY front/package*.json ./
RUN npm ci --prefer-offline

COPY front/ ./
RUN npm run build

# ── Stage 2: Build Go binary ───────────────────────────────────────────────────
FROM golang:1.22-alpine AS go-builder

WORKDIR /app

COPY go.mod ./
COPY *.go ./

COPY --from=frontend-builder /front/dist ./front/dist

RUN go mod tidy && \
    CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o server .

# ── Stage 3: Minimal runtime ───────────────────────────────────────────────────
FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app
COPY --from=go-builder /app/server ./server

EXPOSE 8080
ENTRYPOINT ["./server"]
