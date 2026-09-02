FROM golang:1.25.4-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY api ./api
COPY rpc ./rpc
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /hub-api ./api

# Pin both Node and PI exactly. PI is invoked only as a local RPC subprocess;
# credentials remain in the runtime-mounted protected models.json.
FROM node:22.19.0-alpine@sha256:d2166de198f26e17e5a442f537754dd616ab069c47cc57b889310a717e0abbf9 AS pi
ARG PI_VERSION=0.84.4
RUN npm install --global --omit=dev @earendil-works/pi-coding-agent@${PI_VERSION} \
    && pi --version

FROM node:22.19.0-alpine@sha256:d2166de198f26e17e5a442f537754dd616ab069c47cc57b889310a717e0abbf9
RUN apk add --no-cache ca-certificates wget su-exec \
    && addgroup -S tah \
    && adduser -S -G tah -h /app tah \
    && mkdir -p /var/lib/tah/pi-sessions \
    && chown -R tah:tah /var/lib/tah
COPY --from=build /hub-api /usr/local/bin/hub-api
COPY --from=pi /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=pi /usr/local/bin/pi /usr/local/bin/pi
COPY deploy/docker-compose/docker-entrypoint.sh /usr/local/bin/docker-entrypoint
RUN chmod 0755 /usr/local/bin/docker-entrypoint
ENTRYPOINT ["/usr/local/bin/docker-entrypoint"]
CMD ["/usr/local/bin/hub-api"]
