FROM golang:1.25.4-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY api ./api
COPY rpc ./rpc
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /hub-api ./api
FROM alpine:3.21
RUN apk add --no-cache ca-certificates wget && addgroup -S tah && adduser -S -G tah -h /app tah
COPY --from=build /hub-api /usr/local/bin/hub-api
USER tah
ENTRYPOINT ["/usr/local/bin/hub-api"]
