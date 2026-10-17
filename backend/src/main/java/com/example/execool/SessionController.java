package com.example.execool;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;

import jakarta.annotation.PostConstruct;

@RestController
@RequestMapping("/api/sessions")
public class SessionController {

    private final SessionWorkspaceService workspaceService;
    private final RestTemplate restTemplate;

    @Value("${app.agent.url}")
    private String agentBaseUrl;

    public SessionController(SessionWorkspaceService workspaceService, RestTemplate restTemplate) {
        this.workspaceService = workspaceService;
        this.restTemplate = restTemplate;
    }

    @PostConstruct
    public void verifyAgentConnection() {
        try {
            restTemplate.getForEntity(agentBaseUrl + "/ping", Void.class);
            System.out.println("[Agent Check] Successfully connected to Go agent at: " + agentBaseUrl);
        } catch (Exception e) {
            System.err.println("[Agent Error] CRITICAL: Could not connect to Go agent at [" + agentBaseUrl + "]. Make sure the agent is running.");
            System.exit(1);
        }
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
                "message", "Сессия и фоновый контейнер успешно инициализированы"
        ));
    }

    // Получение списка файлов проекта
    @GetMapping("/{sessionId}/files")
    public ResponseEntity<?> getProjectFiles(@PathVariable String sessionId) {
        if (!workspaceService.sessionExists(sessionId)) {
            return ResponseEntity.status(404).body(Map.of(
                    "error", "SESSION_EXPIRED",
                    "message", "Сессия не найдена или истекла"
            ));
        }

        List<String> files = workspaceService.listFiles(sessionId);
        return ResponseEntity.ok(Map.of("files", files));
    }

    // Получение содержимого конкретного файла
    @GetMapping("/{sessionId}/file")
    public ResponseEntity<?> getFileContent(
            @PathVariable String sessionId,
            @RequestParam("path") String filePath) {
        
        if (!workspaceService.sessionExists(sessionId)) {
            return ResponseEntity.status(404).body(Map.of(
                    "error", "SESSION_EXPIRED",
                    "message", "Сессия не найдена или истекла"
            ));
        }
        
        String content = workspaceService.getFileContent(sessionId, filePath);
        
        if (content == null) {
            return ResponseEntity.status(404).body(Map.of("error", "Файл не найден или путь недопустим"));
        }

        return ResponseEntity.ok(Map.of(
                "file_path", filePath,
                "content", content
        ));
    }

    // Сохранение файлов проекта
    @PutMapping("/{sessionId}/file")
    public ResponseEntity<Map<String, Object>> saveFile(
            @PathVariable String sessionId,
            @RequestBody Map<String, String> request) {
        
        if (!workspaceService.sessionExists(sessionId)) {
            return ResponseEntity.status(404).body(Map.of(
                    "error", "SESSION_EXPIRED",
                    "message", "Сессия не найдена или истекла"
            ));
        }

        String filePath = request != null ? request.get("file_path") : null;
        String content = request != null ? request.get("content") : null;

        if (filePath == null || filePath.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Параметр file_path обязателен"));
        }

        boolean success = workspaceService.saveFile(sessionId, filePath, content);

        if (!success) {
            return ResponseEntity.status(400).body(Map.of("error", "Не удалось сохранить файл (ошибка пути или записи)"));
        }

        return ResponseEntity.ok(Map.of("status", "saved"));
    }

    // Удаление файлов проекта
    @DeleteMapping("/{sessionId}/file")
    public ResponseEntity<Map<String, Object>> deleteFile(
            @PathVariable String sessionId,
            @RequestParam("path") String filePath) {
        
        if (!workspaceService.sessionExists(sessionId)) {
            return ResponseEntity.status(404).body(Map.of(
                    "error", "SESSION_EXPIRED",
                    "message", "Сессия не найдена или истекла"
            ));
        }

        if (filePath == null || filePath.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Параметр path обязателен"));
        }

        boolean success = workspaceService.deleteFile(sessionId, filePath);

        if (!success) {
            return ResponseEntity.status(404).body(Map.of("error", "Не удалось удалить файл (файл не найден или ошибка пути)"));
        }

        return ResponseEntity.ok(Map.of(
                "status", "deleted",
                "file_path", filePath
        ));
    }

    // Запуск кода через существующий контейнер сессии
    @PostMapping("/{sessionId}/run")
    public ResponseEntity<Map<String, Object>> runCode(
            @PathVariable String sessionId,
            @RequestBody Map<String, String> request) {
        
        if (!workspaceService.sessionExists(sessionId)) {
            return ResponseEntity.status(404).body(Map.of(
                    "error", "SESSION_EXPIRED",
                    "message", "Сессия не найдена или истекла"
            ));
        }

        String command = request != null ? request.get("command") : null;
        if (command == null || command.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Параметр command обязателен"));
        }

        try {
            String agentUrl = agentBaseUrl + "/session/" + sessionId + "/run";
            Map<String, String> agentRequest = Map.of("command", command);

            ResponseEntity<Map> agentResponse = restTemplate.postForEntity(agentUrl, agentRequest, Map.class);
            return ResponseEntity.ok(agentResponse.getBody());

        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of(
                    "error", "Ошибка выполнения кода в агенте: " + e.getMessage()
            ));
        }
    }

    // Закрытие сессии
    @DeleteMapping("/{sessionId}")
    public ResponseEntity<Map<String, Object>> stopSession(@PathVariable String sessionId) {
        workspaceService.deleteSessionWorkspace(sessionId);
        
        return ResponseEntity.ok(Map.of(
                "session_id", sessionId,
                "status", "terminated"
        ));
    }
}