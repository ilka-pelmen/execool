# --- сборка агента ---
FROM docker.io/library/golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/execool-agent .

# --- Pyrefly: версия обязательна и закрепляется при сборке ---
# docker build --build-arg PYREFLY_VERSION=<версия> .
FROM docker.io/library/python:3.13-slim AS pyrefly
ARG PYREFLY_VERSION
RUN test -n "$PYREFLY_VERSION" || (echo "Укажи --build-arg PYREFLY_VERSION=<версия>" && false)
RUN python -m venv /opt/pyrefly \
 && /opt/pyrefly/bin/pip install --no-cache-dir "pyrefly==${PYREFLY_VERSION}"

# --- запуск ---
FROM docker.io/library/python:3.13-slim
RUN useradd --system --create-home --home-dir /home/agent agent
COPY --from=pyrefly /opt/pyrefly /opt/pyrefly
COPY --from=build /out/execool-agent /usr/local/bin/execool-agent
ENV PATH="/opt/pyrefly/bin:${PATH}" \
    AGENT_PORT=6721 \
    AGENT_INTERNAL_ADDR=0.0.0.0:6722
USER agent
EXPOSE 6721
CMD ["/usr/local/bin/execool-agent"]
