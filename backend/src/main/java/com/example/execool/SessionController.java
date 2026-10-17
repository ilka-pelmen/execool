package com.example.execool;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/sessions")
public class SessionController {

    private final SessionWorkspaceService workspaceService;

    public SessionController(SessionWorkspaceService workspaceService) {
        this.workspaceService = workspaceService;
    }

    private boolean isInvalid(String value) {
        return value == null || value.isBlank();
    }

    @PostMapping("/start")
    public ResponseEntity<Map<String, Object>> startSession(@RequestBody Map<String, String> request) {
        String projectId = request != null ? request.get("project_id") : null;
        String userId = request != null ? request.get("user_id") : null;

        if (isInvalid(projectId) || isInvalid(userId)) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "Параметры project_id и user_id обязательны и не должны быть пустыми"
            ));
        }

        String sessionId = workspaceService.createSessionWorkspace(projectId, userId);
        if (sessionId == null) {
            return ResponseEntity.internalServerError().body(Map.of(
                    "error", "Не удалось инициализировать рабочее пространство сессии"
            ));
        }

        return ResponseEntity.ok(Map.of(
                "session_id", sessionId,
                "status", "ready",
                "message", "Сессия успешно инициализирована"
        ));
    }

    // Получение списка файлов проекта (для дерева файлов в UI)
    @GetMapping("/{sessionId}/files")
    public ResponseEntity<?> getProjectFiles(@PathVariable String sessionId) {
        List<String> files = workspaceService.listFiles(sessionId);
        return ResponseEntity.ok(Map.of("files", files));
    }

    // Получение содержимого конкретного файла (при клике в редакторе)
    @GetMapping("/{sessionId}/file")
    public ResponseEntity<?> getFileContent(
            @PathVariable String sessionId,
            @RequestParam("path") String filePath) {
        
        String content = workspaceService.getFileContent(sessionId, filePath);
        
        if (content == null) {
            return ResponseEntity.status(404).body(Map.of("error", "Файл не найден или путь недопустим"));
        }

        return ResponseEntity.ok(Map.of(
                "file_path", filePath,
                "content", content
        ));
    }

    // 2. Сохранение файлов проекта (Автосохранение / По требованию)
    @PutMapping("/{sessionId}/files")
    public ResponseEntity<Map<String, Object>> saveFile(
            @PathVariable String sessionId,
            @RequestBody Map<String, String> request) {
        
        String filePath = request.get("file_path");
        String content = request.get("content");

        if (filePath == null || filePath.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Параметр file_path обязателен"));
        }

        boolean success = workspaceService.saveFile(sessionId, filePath, content);

        if (!success) {
            return ResponseEntity.status(400).body(Map.of("error", "Не удалось сохранить файл (ошибка пути или записи)"));
        }

        return ResponseEntity.ok(Map.of("status", "saved"));
    }

    // 3. Запуск кода (Заглушка под будущий Go-агент)
    @PostMapping("/{sessionId}/run")
    public ResponseEntity<Map<String, Object>> runCode(
            @PathVariable String sessionId,
            @RequestBody Map<String, String> request) {
        
        if (!workspaceService.sessionExists(sessionId)) {
            return ResponseEntity.status(404).body(Map.of("error", "Сессия не найдена"));
        }

        String command = request != null ? request.get("command") : null;
        if (command == null || command.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Параметр command обязателен"));
        }

        // TODO: Здесь в будущем будет вызов Go-агента через HTTP/gRPC

        return ResponseEntity.ok(Map.of(
                "exit_code", 0,
                "output", "Dummy execution output for command: " + command + "\n"
        ));
    }

    // 4. Закрытие сессии (Удаление рабочей папки)
    @DeleteMapping("/{sessionId}")
    public ResponseEntity<Map<String, Object>> stopSession(@PathVariable String sessionId) {
        workspaceService.deleteSessionWorkspace(sessionId);
        
        return ResponseEntity.ok(Map.of(
                "session_id", sessionId,
                "status", "terminated"
        ));
    }
}