FROM docker.io/library/golang:1.27-alpine AS build
WORKDIR /src

COPY go.mod ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build \
    -trimpath \
    -ldflags="-s -w" \
    -o /out/execool-agent .

FROM quay.io/podman/stable
COPY --from=build /out/execool-agent /usr/local/bin/execool-agent
COPY --from=ghcr.io/astral-sh/ruff:0.14.7 /ruff /usr/local/bin/ruff

USER podman
ENV AGENT_PORT=6721
EXPOSE 6721

CMD ["/usr/local/bin/execool-agent"]
