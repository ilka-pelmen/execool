# Execool

Легковесная веб-IDE с гибридной архитектурой выполнения кода и удаленным LSP на бэкенде.
Написано на Java 17 Springboot + Preact

## Системные требования
- JDK 17 (для бэкенда, например OpenJ9)
- Node.js 18+ и npm/pnpm (для фронтенда)

## Запуск в разработке

### 1. Бэкенд (Spring Boot)
```bash
cd backend
./mvnw spring-boot:run
```
(Доступно на http://localhost:6767)

### 2. Фронтенд (Preact + Vite)
```bash
cd frontend
npm install
npm run dev
```

(Доступно на http://localhost:5173, запросы к /api проксируются на бэкенд)