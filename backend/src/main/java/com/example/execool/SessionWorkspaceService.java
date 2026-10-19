package com.example.execool;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.net.URI;

@Service
public class SessionWorkspaceService {

    private final RestTemplate restTemplate;

    @Value("${app.agent.url}")
    private String agentBaseUrl;

    public SessionWorkspaceService(RestTemplate restTemplate) {
        this.restTemplate = restTemplate;
    }

    private static class SessionRunResult {
        public int exit_code;
        public String output;
    }

    public boolean sessionExists(String sessionId) {
        if (sessionId == null || sessionId.isBlank()) {
            return false;
        }
        try {
            String agentUrl = agentBaseUrl + "/session/" + sessionId + "/run";
            Map<String, String> requestBody = Map.of("command", "true");
            ResponseEntity<SessionRunResult> response = restTemplate.postForEntity(agentUrl, requestBody, SessionRunResult.class);
            return response.getStatusCode().is2xxSuccessful() && response.getBody() != null && response.getBody().exit_code == 0;
        } catch (Exception e) {
            return false;
        }
    }

    public String createSessionWorkspace(String projectId, String userId) {
        String sessionId = java.util.UUID.randomUUID().toString();
        
        try {
            String agentUrl = agentBaseUrl + "/session/start";
            Map<String, String> requestBody = Map.of("session_id", sessionId);
            
            restTemplate.postForEntity(agentUrl, requestBody, Map.class);
            
            System.out.println("[Backend] Запрошен запуск сессии у агента: " + sessionId);
            return sessionId;
            
        } catch (Exception e) {
            System.err.println("[Backend Error] Ошибка инициализации сессии в агенте: " + e.getMessage());
            return null;
        }
    }

    public void deleteSessionWorkspace(String sessionId) {
        try {
            String agentUrl = agentBaseUrl + "/session/" + sessionId;
            restTemplate.delete(agentUrl);
            System.out.println("[Backend] Сессия полностью удалена через агента: " + sessionId);
        } catch (Exception e) {
            System.err.println("[Backend Error] Ошибка удаления сессии в агенте: " + e.getMessage());
        }
    }

    public boolean saveFile(String sessionId, String filePath, String content) {
        try {
            URI uri = UriComponentsBuilder.fromUriString(agentBaseUrl + "/session/{id}/file")
                .queryParam("path", "{path}")
                .encode()
                .buildAndExpand(sessionId, filePath)
                .toUri();

            restTemplate.put(uri, content != null ? content : "");
            return true;
        } catch (Exception e) {
            System.err.println("[Backend Error] Ошибка сохранения файла: " + e.getMessage());
            return false;
        }
    }

    public boolean deleteFile(String sessionId, String filePath) {
        try {
            URI uri = UriComponentsBuilder.fromUriString(agentBaseUrl + "/session/{id}/file")
                .queryParam("path", "{path}")
                .encode()
                .buildAndExpand(sessionId, filePath)
                .toUri();

            restTemplate.exchange(uri, HttpMethod.DELETE, null, Void.class);
            return true;
        } catch (Exception e) {
            System.err.println("[Backend Error] Ошибка удаления файла: " + e.getMessage());
            return false;
        }
    }

    public String getFileContent(String sessionId, String filePath) {
        try {
            URI uri = UriComponentsBuilder.fromUriString(agentBaseUrl + "/session/{id}/file")
                .queryParam("path", "{path}")
                .encode()
                .buildAndExpand(sessionId, filePath)
                .toUri();

            return restTemplate.getForObject(uri, String.class);
        } catch (Exception e) {
            System.err.println("[Backend Error] Ошибка чтения файла: " + e.getMessage());
            return null;
        }
    }

    public List<String> listFiles(String sessionId) {
        try {
            String agentUrl = agentBaseUrl + "/session/" + sessionId + "/files";
            ResponseEntity<List> response = restTemplate.getForEntity(agentUrl, List.class);
            
            if (response.getBody() != null) {
                @SuppressWarnings("unchecked")
                List<String> files = (List<String>) response.getBody();
                return files;
            }
        } catch (Exception e) {
            System.err.println("[Backend Error] Ошибка получения списка файлов: " + e.getMessage());
        }
        return new ArrayList<>();
    }
}