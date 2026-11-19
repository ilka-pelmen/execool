# Execool

Веб-IDE для Python. Код выполняется прямо в браузере (Pyodide), а подсказки, диагностика и переход к определению приходят от языкового сервера Pyrefly, который работает на отдельном сервисе (агенте). Подсказки включаются тумблером в верхней панели: пока он выключен, код проекта на сервер не отправляется.

## Как это устроено

```
Браузер ──/api──► Бэкенд (Spring Boot) ──/internal──► Агент (Go) ──► Pyrefly
   │                                                    ▲
   └────── файлы проекта (HTTP) и LSP (WebSocket) ──────┘
```

| Компонент | Что делает | Порт |
| :--- | :--- | :--- |
| **Фронтенд** (`frontend/`, Preact + Vite + CodeMirror) | Редактор, проводник файлов, терминал. Python выполняется в Web Worker через Pyodide (Python 3.14). Проекты хранятся в `localStorage`, экспорт в ZIP. | 5173 в разработке |
| **Бэкенд** (`backend/`, Spring Boot) | Создаёт сессии на агенте, выдаёт браузеру токены и билеты. В собранном виде отдаёт и сам фронтенд. | 6767 |
| **Агент** (`agent/`, Go) | Хранит зеркало файлов проекта в рабочей папке сессии, запускает Pyrefly и пересылает его сообщения по WebSocket. Браузер ходит к агенту напрямую. | 6721 |

Источник правды по проекту всегда браузер: на агенте лежит только копия для языкового сервера, и она удаляется при выключении подсказок, закрытии вкладки или простое сессии.

Контракты между частями описаны в [API.MD](API.MD).

## Требования

- Java 17+
- Go 1.23+
- Node.js 22 (Vite 8 требует 20.19+ или 22.12+)
- Pyrefly (только для запуска агента без Docker): `pip install pyrefly==<версия>`
- Docker, чтобы собрать образы

## Запуск в разработке

Общие переменные окружения (пример: `.test-env`, подключается командой `source .test-env`):

```bash
export AGENT_API_KEY=<не короче 16 символов>
export AGENT_TOKEN_SECRET=<не короче 32 символов>
export AGENT_ID=local-agent-1
```

Три терминала:

```bash
# 1. Агент (http://localhost:6721)
cd agent
go run .

# 2. Бэкенд (http://localhost:6767)
cd backend
./mvnw spring-boot:run

# 3. Фронтенд (http://localhost:5173, запросы /api проксируются на бэкенд)
cd frontend
npm install
npm run dev
```

Пакет `pyodide` ставится вместе с зависимостями, а скрипт `prebuild` копирует его рантайм в `frontend/public/pyodide`.

## Переменные окружения

### Агент

| Переменная | По умолчанию | Назначение |
| :--- | :--- | :--- |
| `AGENT_API_KEY` | обязательна, 16+ символов | Ключ внутреннего API (вызовы от бэкенда) |
| `AGENT_TOKEN_SECRET` | обязательна, 32+ символов | Секрет подписи токенов, общий с бэкендом |
| `AGENT_ID` | `agent-1` | Идентификатор агента в токенах; должен совпадать с бэкендом |
| `AGENT_PORT` | `6721` | Порт агента |
| `AGENT_ALLOWED_ORIGINS` | `http://localhost:*,http://127.0.0.1:*` | Адреса страниц, которым разрешено обращаться к агенту (CORS и WebSocket) |
| `AGENT_INTERNAL_ALLOWED` | пусто | IP-адреса и сети (через запятую), с которых разрешён внутренний API `/internal`; пусто означает без ограничения |
| `AGENT_LSP_COMMANDS` | `{"python":["pyrefly","lsp"]}` | Команда запуска языкового сервера для каждого языка (JSON) |
| `AGENT_WORKSPACE_DIR` | `<tmp>/execool-lsp` | Где создаются рабочие папки сессий |
| `AGENT_MAX_SESSIONS` | `50` | Сессий на агенте |
| `AGENT_MAX_LSP` | `4` | Одновременных процессов языкового сервера |
| `AGENT_SESSION_IDLE` | `15m` | Сессия без активности удаляется |
| `AGENT_LSP_IDLE` | `5m` | WebSocket без активности закрывается |
| `AGENT_SESSION_MAX` | `4h` | Максимальный срок жизни сессии |
| `AGENT_MAX_FILES` | `100` | Файлов в сессии |
| `AGENT_MAX_FILE_BYTES` | `1048576` | Размер одного файла |
| `AGENT_MAX_TOTAL_BYTES` | `5242880` | Общий размер файлов сессии |
| `AGENT_MAX_MESSAGE` | `2097152` | Максимальный размер сообщения LSP |

Версия Python для анализа задана в `agent/lsp.go` (`python-version`) и должна совпадать с версией Pyodide (сейчас 3.14).

### Бэкенд

| Переменная | По умолчанию | Назначение |
| :--- | :--- | :--- |
| `AGENT_API_KEY`, `AGENT_TOKEN_SECRET`, `AGENT_ID` | обязательны | Те же значения, что у агента |
| `AGENT_PUBLIC_URL` | `http://localhost:6721` | Адрес агента, доступный из браузера |
| `AGENT_INTERNAL_URL` | как `AGENT_PUBLIC_URL` | Адрес агента для вызовов бэкенда (например, `http://agent:6721` или loopback) |
| `SERVER_PORT` | `6767` | Порт бэкенда |
| `APP_CORS_ALLOWED_ORIGINS` | `http://localhost:3000,http://localhost:5173` | Нужна только если страница открыта не с самого бэкенда |

## Docker

Образы собираются из **корня репозитория**, Dockerfile лежат в `docker/`.

| Образ | Что внутри | Сборка |
| :--- | :--- | :--- |
| `execool-agent` | Агент и Pyrefly | `docker build -f docker/agent.Dockerfile --build-arg PYREFLY_VERSION=<версия> -t execool-agent .` |
| `execool-backend` | Бэкенд и собранный фронтенд | `docker build -f docker/backend.Dockerfile -t execool-backend .` |
| `execool` | Всё вместе: бэкенд, фронтенд, агент и прокси Caddy в одном контейнере, один порт | `docker build -f docker/all-in-one.Dockerfile --build-arg PYREFLY_VERSION=<версия> -t execool .` |

Версию Pyrefly нужно указывать явно, чтобы сборка была воспроизводимой. Список доступных версий: `pip index versions pyrefly`.

### Раздельные образы

```bash
docker run -d --name execool-agent -p 6721:6721 \
  -e AGENT_API_KEY=... -e AGENT_TOKEN_SECRET=... -e AGENT_ID=agent-1 \
  -e AGENT_ALLOWED_ORIGINS=http://localhost:6767 \
  execool-agent

docker run -d --name execool-backend -p 6767:6767 \
  -e AGENT_API_KEY=... -e AGENT_TOKEN_SECRET=... -e AGENT_ID=agent-1 \
  -e AGENT_PUBLIC_URL=http://localhost:6721 \
  -e AGENT_INTERNAL_URL=http://<адрес агента, видимый из бэкенда>:6721 \
  execool-backend
```

### Один образ

```bash
docker run -d --name execool -p 8080:8080 \
  -e AGENT_API_KEY=... -e AGENT_TOKEN_SECRET=... -e AGENT_ID=agent-1 \
  execool
```

Приложение открывается на `http://localhost:8080`. Наружу открыт один порт: перед бэкендом и агентом стоит прокси Caddy (`docker/Caddyfile`).

| Путь | Куда |
| :--- | :--- |
| `/`, `/api/*` | Бэкенд (он же отдаёт фронтенд) |
| `/agent/*` | Агент, включая WebSocket языкового сервера |
| `/agent/internal/*` | Закрыт (404): внутренний API наружу не отдаётся |

Бэкенд обращается к агенту по `127.0.0.1`, а внутренний API агента разрешён только с этого адреса (`AGENT_INTERNAL_ALLOWED=127.0.0.1` задано в образе). Если один из процессов завершается, контейнер останавливается целиком.

Адрес агента для браузера задаётся `AGENT_PUBLIC_URL` и обязательно содержит префикс `/agent`. Для настоящего домена его нужно указать при запуске:

```bash
  -e AGENT_PUBLIC_URL=https://ide.example.com/agent
```

Страница и агент оказываются на одном адресе, поэтому CORS настраивать не нужно. TLS в образе нет: поставьте перед контейнером обратный прокси с сертификатом и пробрасывайте WebSocket.

## Безопасность и развёртывание

- **Один открытый порт.** Внутренний API агента доступен по пути `/internal/…` на том же порту, что и публичный. Его защищает ключ API и список `AGENT_INTERNAL_ALLOWED`. Для продакшена задайте этот список или закройте путь `/internal/` на обратном прокси. В образе `execool` это уже сделано: прокси отдаёт агента только под `/agent/` и закрывает `/agent/internal/`.
- **TLS.** Ключ API и токены не должны ходить открытым текстом. Поставьте перед сервисами обратный прокси с TLS; адреса `AGENT_PUBLIC_URL` тогда будут `https://`, а WebSocket автоматически `wss://`.
- **Секреты.** Ключ API и секрет токенов генерируйте случайными (`openssl rand -hex 32`); для разных сред используйте разные значения.
- **Браузер не видит пути на сервере.** Рабочая папка сессии отображается как `file:///workspace`, заглушки стандартной библиотеки как `file:///typeshed`.
- **Идентификатор сессии** в этой схеме играет роль секрета, поэтому его не стоит показывать в ссылках и журналах.

## Тесты

```bash
cd agent && go test ./...
cd frontend && npm test
cd backend && ./mvnw test      # нужны AGENT_API_KEY, AGENT_TOKEN_SECRET и AGENT_ID в окружении
```

## Структура репозитория

```
agent/       Go-агент: сессии, файлы, мост WebSocket к Pyrefly
backend/     Spring Boot: сессии, токены, раздача фронтенда
frontend/    Preact + CodeMirror + Pyodide
docker/      Dockerfile: агент, бэкенд с фронтендом, всё в одном (и Caddyfile для него)
API.MD       контракты между частями
.test-env    пример переменных окружения для локального запуска
```
