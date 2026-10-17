# Контракты взаимодействия (Execool)

## 1. Фронтенд (Preact) ↔ Бэкенд (Spring Boot)
Базовый префикс: `/api/sessions`

| Метод | Путь | Тело запроса (JSON) / Параметры | Описание / Ответ |
| :--- | :--- | :--- | :--- |
| **POST** | `/start` | `{"project_id": "...", "user_id": "..."}` | Создать сессию. Ответ: `{"session_id": "...", "status": "ready", ...}` |
| **GET** | `/{sessionId}/files` | — | Список файлов проекта. Ответ: `{"files": ["main.py", ...]}` |
| **GET** | `/{sessionId}/file` | Query: `?path=file.py` | Читать файл. Ответ: `{"file_path": "...", "content": "..."}` |
| **PUT** | `/{sessionId}/file` *(или `/files`)* | `{"file_path": "...", "content": "..."}` | Сохранить файл. Ответ: `{"status": "saved"}` |
| **DELETE**| `/{sessionId}/file` | Query: `?path=file.py` | Удалить файл. Ответ: `{"status": "deleted", "file_path": "..."}` |
| **POST** | `/{sessionId}/run` | `{"command": "python3 main.py"}` | Запуск кода. Ответ: `{"exit_code": 0, "output": "..."}` |
| **DELETE**| `/{sessionId}` | — | Закрыть сессию и удалить контейнер. Ответ: `{"session_id": "...", "status": "terminated"}` |

---

## 2. Бэкенд (Spring Boot) ↔ Агент (Go)
Базовый префикс: URL агента из конфигурации (`app.agent.url`, например `http://localhost:6721`)

| Метод | Путь | Тело запроса / Параметры | Описание / Ответ |
| :--- | :--- | :--- | :--- |
| **GET** | `/ping` | — | Health-check агента. Ответ: `200 OK` |
| **POST** | `/session/start` | `{"session_id": "..."}` | Поднять фоновый контейнер Podman с Python. Ответ: `200 OK` |
| **POST** | `/session/{sessionId}/run` | `{"command": "..."}` | Выполнить команду через `podman exec`. Ответ: `{"exit_code": 0, "output": "..."}` |
| **DELETE**| `/session/{sessionId}` | — | Удалить контейнер (`podman rm -f`) и файлы сессии. Ответ: `200 OK` |
| **PUT** | `/session/{sessionId}/file` | Query: `?path=...` <br> Тело: Сырые байты (`[]byte`) | Записать файл в рабочую директорию контейнера. Ответ: `200 OK` |
| **GET** | `/session/{sessionId}/file` | Query: `?path=...` | Прочитать файл из контейнера. Ответ: Текст файла (`text/plain`) |
| **DELETE**| `/session/{sessionId}/file` | Query: `?path=...` | Удалить файл из контейнера. Ответ: `200 OK` |
| **GET** | `/session/{sessionId}/files` | — | Получить JSON-массив путей файлов сессии. Ответ: `["main.py", ...]` |