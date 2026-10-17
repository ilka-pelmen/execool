# Execool

Легковесная веб-IDE с гибридной архитектурой выполнения кода в изолированных контейнерах (Podman) и бэкендом на Java/Spring Boot + Preact.

## Системные требования
- **Java 17+**
- **Go 1.21+**
- **Node.js 18+ и npm/pnpm**
- **Podman**

## Архитектура
1. **Фронтенд**: Preact + Vite (`http://localhost:5173`)
2. **Бэкенд**: Spring Boot (`http://localhost:6767`), управляющий сессиями и проксирующий запросы.
3. **Агент**: Go-сервис (`http://localhost:6721`), управляющий жизненным циклом Podman-контейнеров и файлами сессий.

---

## Запуск в разработке

### Ручной запуск (по компонентам)
1. Go-агент (Sandbox Manager)
```bash
cd agent
go run main.go session.go config.go
```
(Доступно на http://localhost:6721)

2. Бэкенд (Spring Boot)
```bash
cd backend
./mvnw spring-boot:run
```
(Доступно на http://localhost:6767)

3. Фронтенд (Preact + Vite)
```bash
cd frontend
npm install
npm run dev
```
(Доступно на http://localhost:5173, запросы к /api проксируются на бэкенд)

## Сборка

1. Go-агент
```bash
cd agent
go build -o execool-agent main.go session.go config.go
```

2. Frontend
```bash
cd frontend
npm install
npm run build
```

3. Backend
```bash
cd backend
./mvnw clean package -DskipTests
```