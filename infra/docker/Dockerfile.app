# Linux server application: normal PrintOps UI + API, with an optional runner.
# The runner is a separate process/container; API never starts a second worker.
FROM golang:1.26-alpine AS runner
WORKDIR /src
COPY apps/runner-go/go.mod apps/runner-go/go.sum ./
RUN go mod download
COPY apps/runner-go ./
ARG APP_VERSION
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X github.com/phcaradanai/print_ops/apps/runner-go/internal/config.Version=${APP_VERSION}" -o /printops-runner ./cmd/printops-runner

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY packages/domain ./packages/domain
COPY packages/shared ./packages/shared
COPY packages/adapters ./packages/adapters
COPY apps/api ./apps/api
COPY apps/web ./apps/web
RUN npm ci --no-audit --no-fund
RUN npm run build:packages && npm run build -w apps/api
RUN VITE_CONTROL_APP=false npm run build -w apps/web

FROM node:22-alpine
ARG APP_VERSION
ARG SOURCE_REVISION
LABEL org.opencontainers.image.title="PrintOps App" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${SOURCE_REVISION}"
RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S printops && adduser -S printops -G printops \
    && mkdir -p /data/releases && chown -R printops:printops /data
WORKDIR /app/apps/api
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages/domain/dist /app/packages/domain/dist
COPY --from=build /app/packages/domain/package.json /app/packages/domain/package.json
COPY --from=build /app/packages/shared/dist /app/packages/shared/dist
COPY --from=build /app/packages/shared/package.json /app/packages/shared/package.json
COPY --from=build /app/packages/adapters/dist /app/packages/adapters/dist
COPY --from=build /app/packages/adapters/package.json /app/packages/adapters/package.json
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/package.json ./package.json
# Existing API staticRoots resolves ../web/dist from this working directory.
COPY --from=build /app/apps/web/dist /app/apps/web/dist
COPY --from=runner /printops-runner /usr/local/bin/printops-runner
ENV PRINTOPS_APP_VERSION=${APP_VERSION} \
    NODE_ENV=production HOST=0.0.0.0 PORT=3001 \
    DB_MODE=sqlite STORAGE_PROVIDER=local PRINTOPS_DATA_DIR=/data PRINTOPS_DB_PATH=/data/printops.db \
    PRINTOPS_RELEASES_DIR=/data/releases PRINTOPS_DEVICE_IDENTITY_PATH=/data/device-identity.json \
    SQL_WASM_PATH=/app/node_modules/sql.js/dist/sql-wasm.wasm \
    PRINTOPS_DEV_SEED=false PRINTOPS_RUNTIME_MODE=server PRINTOPS_LOCAL_WORKER=false \
    PRINTOPS_JOBS_ENABLED=false
USER printops
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
