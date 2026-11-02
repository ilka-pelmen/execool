package com.example.execool;

import com.fasterxml.jackson.annotation.JsonProperty;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/sessions")
public class SessionController {

    private static final String DEFAULT_LANGUAGE = "python";

    private final SessionWorkspaceService workspaceService;
    private final AgentTokenService tokenService;
    private final String agentPublicUrl;

    public SessionController(
            SessionWorkspaceService workspaceService,
            AgentTokenService tokenService,
            @Value("${app.agent.public-url}") String agentPublicUrl) {
        this.workspaceService = workspaceService;
        this.tokenService = tokenService;
        this.agentPublicUrl = agentPublicUrl.replaceAll("/+$", "");
    }

    public record StartRequest(
            @JsonProperty("project_id") String projectId,
            @JsonProperty("user_id") String userId,
            @JsonProperty("language_id") String languageId) {}

    public record StartResponse(
            @JsonProperty("session_id") String sessionId,
            String language,
            @JsonProperty("root_uri") String rootUri,
            AgentSession.AgentLimits limits,
            @JsonProperty("files_token") String filesToken,
            String status) {}

    public record StartLspResponse(
            @JsonProperty("websocket_url") String websocketUrl,
            String ticket,
            @JsonProperty("expires_in_seconds") long expiresInSeconds) {}

    @PostMapping("/start")
    public ResponseEntity<?> start(
            @RequestBody(required = false) StartRequest request) {
        String language = request == null || isBlank(request.languageId())
                ? DEFAULT_LANGUAGE
                : request.languageId().trim();

        // user_id и project_id из анонимного запроса — только переданные клиентом
        // значения, а не подтверждённая личность пользователя.
        String id = UUID.randomUUID().toString();

        try {
            AgentSession session = workspaceService.createSession(id, language);

            String filesToken = tokenService.issueToken(
                    session.id(),
                    "files",
                    Duration.ofMinutes(15)
            );

            return ResponseEntity.status(HttpStatus.CREATED).body(
                    new StartResponse(
                            session.id(),
                            session.language(),
                            session.rootUri(),
                            session.limits(),
                            filesToken,
                            "ready"
                    )
            );
        } catch (RestClientResponseException e) {
            String body = e.getResponseBodyAsString();
            return ResponseEntity.status(e.getStatusCode()).body(
                    body == null || body.isBlank()
                            ? Map.of("error", "agent_error")
                            : Map.of("error", "agent_error", "details", body)
            );
        } catch (RestClientException e) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(Map.of(
                    "error", "agent_unavailable",
                    "message", "Не удалось связаться с агентом"
            ));
        }
    }

    @PostMapping("/{id}/start-lsp")
    public ResponseEntity<?> startLsp(@PathVariable String id) {
        if (!isValidSessionId(id)) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "invalid_id",
                    "message", "Некорректный идентификатор сессии"
            ));
        }

        AgentTokenService.IssuedTicket issuedTicket = tokenService.issueLSPTicket(id);

        URI publicUri = URI.create(agentPublicUrl);
        String wsScheme = "https".equalsIgnoreCase(publicUri.getScheme())
                ? "wss"
                : "ws";

        String websocketUrl = UriComponentsBuilder
                .fromUriString(agentPublicUrl)
                .scheme(wsScheme)
                .pathSegment("sessions", id, "lsp")
                .queryParam("ticket", issuedTicket.token())
                .build()
                .encode()
                .toUriString();

        return ResponseEntity.ok(new StartLspResponse(
                websocketUrl,
                issuedTicket.token(),
                issuedTicket.expiresInSeconds()
        ));
    }

    @PostMapping("/{id}/files-token")
    public ResponseEntity<?> renewFilesToken(@PathVariable String id) {
        if (!isValidSessionId(id)) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "invalid_id",
                    "message", "Некорректный идентификатор сессии"
            ));
        }

        String token = tokenService.issueFilesToken(id);

        return ResponseEntity.ok(Map.of("files_token", token));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable String id) {
        if (!isValidSessionId(id)) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "invalid_id"
            ));
        }

        try {
            workspaceService.deleteSession(id);
            return ResponseEntity.noContent().build();
        } catch (RestClientResponseException e) {
            return ResponseEntity.status(e.getStatusCode()).body(Map.of(
                    "error", "agent_error"
            ));
        } catch (RestClientException e) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(Map.of(
                    "error", "agent_unavailable"
            ));
        }
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private static boolean isValidSessionId(String id) {
        if (id == null) {
            return false;
        }

        try {
            UUID.fromString(id);
            return true;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }
}
