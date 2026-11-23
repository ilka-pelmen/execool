# Бэкенд на Spring Boot со встроенным фронтендом: Spring сам отдаёт собранные файлы.
# Сборка из КОРНЯ репозитория:
#   docker build -f docker/backend.Dockerfile -t execool-backend .

# 1. Фронтенд (Pyodide копируется из npm-пакета скриптом prebuild)
FROM docker.io/library/node:22-slim AS frontend
WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Без Pyodide в сборке приложение откроется, но Python не запустится.
RUN test -f dist/pyodide/pyodide.mjs || { echo "В dist нет pyodide: проверьте scripts/copy-pyodide.mjs"; exit 1; }

# 2. Бэкенд
FROM docker.io/library/golang:1.26-alpine AS build
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
COPY --from=frontend /app/dist ./static
RUN CGO_ENABLED=0 go build -tags deploy -trimpath -ldflags="-s -w" -o /out/execool .

# 3. Запуск
FROM docker.io/library/alpine:latest
RUN groupadd --system app && useradd --system --gid app --home-dir /app app
WORKDIR /app
COPY --from=build /out/execool /usr/local/bin/execool

ENV SERVER_PORT=6767

USER app
EXPOSE 6767
ENTRYPOINT ["/usr/local/bin/execool"]
