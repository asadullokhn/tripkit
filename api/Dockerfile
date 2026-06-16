# tripkit API — static Go binary (stdlib only) on a slim base
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY *.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags "-s -w" -o /api .

FROM alpine:3.20
RUN apk add --no-cache wget && mkdir -p /data
COPY --from=build /api /usr/local/bin/api
COPY seed /seed
EXPOSE 8080
VOLUME /data
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null 2>&1 || exit 1
ENTRYPOINT ["/usr/local/bin/api"]
