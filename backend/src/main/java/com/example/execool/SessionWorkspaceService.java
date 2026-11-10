package com.example.execool;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

@Service
public class SessionWorkspaceService {

    private final RestTemplate restTemplate;
    private final String agentUrl;
    private final String agentApiKey;

    public SessionWorkspaceService(
            RestTemplate restTemplate,
            @Value("${app.agent.url}") String agentUrl,
            @Value("${app.agent.api-key}") String agentApiKey) {
        this.restTemplate = restTemplate;
        this.agentUrl = agentUrl.replaceAll("/+$", "");
        this.agentApiKey = agentApiKey;
    }

    public AgentSession createSession(String sessionId, String languageId) {
        Map<String, String> body = Map.of(
                "id", sessionId,
                "language", languageId
        );

        ResponseEntity<AgentSession> response = restTemplate.exchange(
                agentUrl + "/internal/sessions",
                HttpMethod.POST,
                agentRequest(body),
                AgentSession.class
        );

        if (response.getBody() == null) {
            throw new IllegalStateException(
                    "Агент вернул пустой ответ при создании сессии");
        }

        return response.getBody();
    }

    public void deleteSession(String sessionId) {
        restTemplate.exchange(
                agentUrl + "/internal/sessions/{id}",
                HttpMethod.DELETE,
                agentRequest(null),
                Void.class,
                sessionId
        );
    }

    private HttpEntity<?> agentRequest(Object body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(agentApiKey);
        headers.setContentType(MediaType.APPLICATION_JSON);
        return new HttpEntity<>(body, headers);
    }
}
