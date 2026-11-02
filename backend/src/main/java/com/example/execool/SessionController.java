package com.example.execool;

import com.fasterxml.jackson.annotation.JsonProperty;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/sessions")
public class SessionController {

    private static final Logger log = LoggerFactory.getLogger(SessionController.class);
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

    public record StartLspRequest(
            @JsonProperty("language_id") String languageId) {}

    /** Данные для подключения к языковому серверу. Билет одноразовый и короткоживущий. */
    public record LspInfo(
            @JsonProperty("websocket_url") String websocketUrl,
            String ticket,
            @JsonProperty("expires_in_seconds") long expiresInSeconds) {}

    public record StartLspResponse(
            @JsonProperty("session_id") String sessionId,
            String language,
            @JsonProperty("root_uri") String rootUri,
            AgentSession.AgentLimits limits,
            @JsonProperty("agent_url") String agentUrl,
            @JsonProperty("files_token") String filesToken,
            @JsonProperty("files_token_expires_in_seconds") long filesTokenExpiresInSeconds,
            LspInfo lsp) {}

    /**
     * Создаёт сессию на агенте и сразу выдаёт всё, что нужно браузеру:
     * адрес агента, токен для файлов и билет для WebSocket.
     */
    @PostMapping("/start-lsp")
    public ResponseEntity<?> startLsp(
            @RequestBody(required = false) StartLspRequest request) {
        String language = request == null || isBlank(request.languageId())
                ? DEFAULT_LANGUAGE
                : request.languageId().trim();

        String id = UUID.randomUUID().toString();

        try {
            AgentSession session = workspaceService.createSession(id, language);

            AgentTokenService.IssuedToken filesToken = tokenService.issueFilesToken(session.id());

            return ResponseEntity.status(HttpStatus.CREATED).body(
                    new StartLspResponse(
                            session.id(),
                            session.language(),
                            session.rootUri(),
                            session.limits(),
                            agentPublicUrl,
                            filesToken.token(),
                            filesToken.expiresInSeconds(),
                            buildLspInfo(session.id())
                    )
            );
        } catch (RestClientResponseException e) {
            return agentFailure(e);
        } catch (RestClientException e) {
            return agentUnavailable(e);
        }
    }

    /** Новый билет для переподключения (билет одноразовый). */
    @PostMapping("/{id}/lsp-ticket")
    public ResponseEntity<?> renewLspTicket(@PathVariable String id) {
        if (!isValidSessionId(id)) {
            return invalidId();
        }
        return ResponseEntity.ok(buildLspInfo(id));
    }

    @PostMapping("/{id}/files-token")
    public ResponseEntity<?> renewFilesToken(@PathVariable String id) {
        if (!isValidSessionId(id)) {
            return invalidId();
        }

        AgentTokenService.IssuedToken token = tokenService.issueFilesToken(id);
        return ResponseEntity.ok(Map.of(
                "files_token", token.token(),
                "files_token_expires_in_seconds", token.expiresInSeconds()
        ));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable String id) {
        if (!isValidSessionId(id)) {
            return invalidId();
        }

        try {
            workspaceService.deleteSession(id);
            return ResponseEntity.noContent().build();
        } catch (RestClientResponseException e) {
            return agentFailure(e);
        } catch (RestClientException e) {
            return agentUnavailable(e);
        }
    }

    // ---- вспомогательное ----

    private LspInfo buildLspInfo(String sessionId) {
        AgentTokenService.IssuedToken ticket = tokenService.issueLspTicket(sessionId);

        URI publicUri = URI.create(agentPublicUrl);
        String wsScheme = "https".equalsIgnoreCase(publicUri.getScheme()) ? "wss" : "ws";

        String websocketUrl = UriComponentsBuilder
                .fromUriString(agentPublicUrl)
                .scheme(wsScheme)
                .pathSegment("sessions", sessionId, "lsp")
                .queryParam("ticket", ticket.token())
                .build()
                .encode()
                .toUriString();

        return new LspInfo(websocketUrl, ticket.token(), ticket.expiresInSeconds());
    }

    /**
     * Ответы агента про запрос клиента (400 неверный язык или id, 503 агент занят)
     * отдаём как есть: тело агента уже JSON с полями error и message.
     * Всё остальное (401 из-за ключа API, 404, 5xx) - проблема между Spring и агентом,
     * браузеру она не принадлежит: логируем и отвечаем 502.
     */
    private ResponseEntity<?> agentFailure(RestClientResponseException e) {
        int status = e.getStatusCode().value();
        String body = e.getResponseBodyAsString();

        if ((status == 400 || status == 503) && body != null && !body.isBlank()) {
            return ResponseEntity.status(status)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body);
        }

        log.error("Agent returned {}: {}", status, body);
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(Map.of(
                "error", "agent_error",
                "message", "Агент вернул непредвиденную ошибку"
        ));
    }

    private ResponseEntity<?> agentUnavailable(RestClientException e) {
        log.error("Agent is unreachable", e);
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(Map.of(
                "error", "agent_unavailable",
                "message", "Не удалось связаться с агентом"
        ));
    }

    private static ResponseEntity<?> invalidId() {
        return ResponseEntity.badRequest().body(Map.of(
                "error", "invalid_id",
                "message", "Некорректный идентификатор сессии"
        ));
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