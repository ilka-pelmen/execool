package com.example.execool;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Locale;
import java.util.UUID;

@Service
public class AgentTokenService {
    private static final Duration FILES_TOKEN_TTL = Duration.ofMinutes(15);
    private static final Duration LSP_TICKET_TTL = Duration.ofSeconds(60);
    private static final String HMAC_ALGORITHM = "HmacSHA256";
    private static final String JWT_HEADER = "{\"alg\":\"HS256\",\"typ\":\"JWT\"}";

    private final String hmacSecret;
    private final String agentId;

    public AgentTokenService(
            @Value("${app.agent.token-secret}") String hmacSecret,
            @Value("${app.agent.id}") String agentId
    ) {
        if (hmacSecret == null || hmacSecret.isBlank()) {
            throw new IllegalArgumentException("app.agent.hmac-secret must not be blank");
        }
        if (agentId == null || agentId.isBlank()) {
            throw new IllegalArgumentException("app.agent.id must not be blank");
        }

        this.hmacSecret = hmacSecret;
        this.agentId = agentId;
    }

    public String issueFilesToken(String sessionId) {
        return issueToken(sessionId, "files", FILES_TOKEN_TTL);
    }

    public IssuedTicket issueLSPTicket(String sessionId) {
        return new IssuedTicket(
                issueToken(sessionId, "lsp", LSP_TICKET_TTL),
                LSP_TICKET_TTL.toSeconds()
        );
    }

    // Оставлен также вариант написания, если он уже используется в контроллере.
    public IssuedTicket issueLspTicket(String sessionId) {
        return issueLSPTicket(sessionId);
    }

    public String issueToken(String sessionId, String scope, Duration ttl) {
        if (sessionId == null || sessionId.isBlank()) {
            throw new IllegalArgumentException("sessionId must not be blank");
        }
        if (!"files".equals(scope) && !"lsp".equals(scope)) {
            throw new IllegalArgumentException("Unsupported token scope: " + scope);
        }
        if (ttl == null || ttl.isZero() || ttl.isNegative()) {
            throw new IllegalArgumentException("ttl must be positive");
        }

        long expiresAt = Instant.now().plus(ttl).getEpochSecond();

        String payload = "{"
                + "\"sid\":" + jsonString(sessionId) + ","
                + "\"scope\":" + jsonString(scope) + ","
                + "\"exp\":" + expiresAt + ","
                + "\"jti\":" + jsonString(UUID.randomUUID().toString()) + ","
                + "\"aud\":" + jsonString(agentId)
                + "}";

        String signingInput = base64Url(JWT_HEADER.getBytes(StandardCharsets.UTF_8))
                + "."
                + base64Url(payload.getBytes(StandardCharsets.UTF_8));

        return signingInput + "." + sign(signingInput);
    }

    private String sign(String value) {
        try {
            Mac mac = Mac.getInstance(HMAC_ALGORITHM);
            mac.init(new SecretKeySpec(
                    hmacSecret.getBytes(StandardCharsets.UTF_8),
                    HMAC_ALGORITHM
            ));
            return base64Url(mac.doFinal(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("Could not sign agent token", e);
        }
    }

    private static String base64Url(byte[] value) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
    }

    private static String jsonString(String value) {
        StringBuilder result = new StringBuilder("\"");

        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);

            switch (c) {
                case '"' -> result.append("\\\"");
                case '\\' -> result.append("\\\\");
                case '\b' -> result.append("\\b");
                case '\f' -> result.append("\\f");
                case '\n' -> result.append("\\n");
                case '\r' -> result.append("\\r");
                case '\t' -> result.append("\\t");
                default -> {
                    if (c < 0x20) {
                        result.append(String.format(Locale.ROOT, "\\u%04x", (int) c));
                    } else {
                        result.append(c);
                    }
                }
            }
        }

        return result.append('"').toString();
    }

    public record IssuedTicket(String token, long expiresInSeconds) {}
}
