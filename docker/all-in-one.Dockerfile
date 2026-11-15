# Всё в одном образе: бэкенд, фронтенд и агент. Два процесса, один контейнер.
# Сборка из КОРНЯ репозитория:
#   docker build -f docker/all-in-one.Dockerfile --build-arg PYREFLY_VERSION=<версия> -t execool .
#
# Наружу открыт один порт (8080): перед бэкендом и агентом стоит прокси Caddy.
#   /        и /api/*  -> бэкенд (он же отдаёт фронтенд)
#   /agent/*           -> агент, включая WebSocket языкового сервера
# Бэкенд обращается к агенту по loopback (AGENT_INTERNAL_URL), а браузер получает адрес
# AGENT_PUBLIC_URL: он должен указывать на этот прокси с префиксом /agent, например
# https://ide.example.com/agent. Страница и агент оказываются на одном адресе, CORS не нужен.
ARG CADDY_VERSION=2

# 1. Фронтенд
FROM docker.io/library/node:22-slim AS frontend
WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build
RUN test -f dist/pyodide/pyodide.mjs || { echo "В dist нет pyodide: проверьте scripts/copy-pyodide.mjs"; exit 1; }

# 2. Бэкенд
FROM docker.io/library/maven:3.9-eclipse-temurin-17 AS backend
WORKDIR /app

COPY backend/pom.xml ./
RUN mvn -B -q dependency:go-offline

COPY backend/src ./src
COPY --from=frontend /app/dist ./src/main/resources/static
RUN mvn -B -q -DskipTests package

RUN set -eu; \
    set -- $(find target -maxdepth 1 -type f -name '*.jar' \
      ! -name '*-sources.jar' \
      ! -name '*-javadoc.jar' \
      ! -name '*-tests.jar'); \
    [ "$#" -eq 1 ] || { echo "Ожидался один JAR приложения, найдено: $#"; exit 1; }; \
    mkdir -p /out; \
    cp "$1" /out/app.jar

# 3. Агент
FROM docker.io/library/golang:1.23-alpine AS agent
WORKDIR /src
COPY agent/go.mod agent/go.sum ./
RUN go mod download
COPY agent/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/execool-agent .

# 4. Pyrefly
FROM docker.io/library/python:3.13-slim AS pyrefly
ARG PYREFLY_VERSION
RUN test -n "$PYREFLY_VERSION" || { echo "Укажите --build-arg PYREFLY_VERSION=<версия>"; exit 1; }
RUN python -m venv /opt/pyrefly \
 && /opt/pyrefly/bin/pip install --no-cache-dir "pyrefly==${PYREFLY_VERSION}"

# 5. Прокси
FROM docker.io/library/caddy:${CADDY_VERSION} AS caddy

# 6. Java (OpenJ9)
FROM docker.io/library/ibm-semeru-runtimes:open-17-jre-noble AS java

# 7. Запуск: образ с Python (нужен окружению Pyrefly) плюс Java для бэкенда
FROM docker.io/library/python:3.13-slim
RUN useradd --system --create-home --home-dir /home/execool execool

COPY --from=java /opt/java/openjdk /opt/java/openjdk
COPY --from=pyrefly /opt/pyrefly /opt/pyrefly
COPY --from=agent /out/execool-agent /usr/local/bin/execool-agent
COPY --from=caddy /usr/bin/caddy /usr/local/bin/caddy
COPY --from=backend --chown=execool:execool /out/app.jar /app/app.jar
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY docker/entrypoint.sh /usr/local/bin/execool-entrypoint
RUN sed -i 's/\r$//' /usr/local/bin/execool-entrypoint && chmod 0755 /usr/local/bin/execool-entrypoint

ENV JAVA_HOME=/opt/java/openjdk \
    PATH="/opt/java/openjdk/bin:/opt/pyrefly/bin:${PATH}" \
    PROXY_PORT=8080 \
    SERVER_PORT=6767 \
    AGENT_PORT=6721 \
    AGENT_PUBLIC_URL=http://localhost:8080/agent \
    AGENT_INTERNAL_URL=http://127.0.0.1:6721 \
    AGENT_INTERNAL_ALLOWED=127.0.0.1

USER execool
EXPOSE 8080

# Проверяем весь путь через прокси: фронтенд и агент.
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=6 \
  CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8080/', timeout=3); u.urlopen('http://127.0.0.1:8080/agent/ping', timeout=3)"

ENTRYPOINT ["/usr/local/bin/execool-entrypoint"]
