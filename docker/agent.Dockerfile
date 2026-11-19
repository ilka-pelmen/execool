# Агент: Go-сервис и языковой сервер Pyrefly.
# Сборка из КОРНЯ репозитория (версию Pyrefly нужно указать явно):
#   docker build -f docker/agent.Dockerfile --build-arg PYREFLY_VERSION=<версия> -t execool-agent .

# 1. Агент
FROM docker.io/library/golang:1.23-alpine AS build
WORKDIR /src
COPY agent/go.mod agent/go.sum ./
RUN go mod download
COPY agent/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/execool-agent .

# 2. Pyrefly в отдельном окружении: версия закрепляется при сборке
FROM docker.io/library/python:3.13-slim AS pyrefly
ARG PYREFLY_VERSION
RUN test -n "$PYREFLY_VERSION" || { echo "Укажите --build-arg PYREFLY_VERSION=<версия>"; exit 1; }
RUN python -m venv /opt/pyrefly \
 && /opt/pyrefly/bin/pip install --no-cache-dir "pyrefly==${PYREFLY_VERSION}"

# 3. Запуск
FROM docker.io/library/python:3.13-slim
RUN useradd --system --create-home --home-dir /home/agent agent
COPY --from=pyrefly /opt/pyrefly /opt/pyrefly
COPY --from=build /out/execool-agent /usr/local/bin/execool-agent

ENV PATH="/opt/pyrefly/bin:${PATH}" \
    AGENT_PORT=6721

USER agent
EXPOSE 6721

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=6 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:6721/ping', timeout=3)"

CMD ["/usr/local/bin/execool-agent"]
