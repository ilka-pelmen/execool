package com.example.execool;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;

@Service
public class LintService {

    // Ответ ruff: нужны только эти поля, остальное игнорируем.
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record RuffDiagnostic(
            String code,
            String message,
            Position location,
            @JsonProperty("end_location") Position endLocation) {

        @JsonIgnoreProperties(ignoreUnknown = true)
        public record Position(int row, int column) {}
    }

    // Ответ нашего API, поля совпадают с маркерами Monaco.
    public record LintIssue(
            int line, int column, int endLine, int endColumn,
            String code, String message, String severity) {}

    private final RestTemplate restTemplate;

    @Value("${app.agent.url}")
    private String agentBaseUrl;

    public LintService(RestTemplate restTemplate) {
        this.restTemplate = restTemplate;
    }

    public List<LintIssue> lint(String code) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(new MediaType("text", "plain", StandardCharsets.UTF_8));

        RuffDiagnostic[] result = restTemplate.postForObject(
                agentBaseUrl + "/lint",
                new HttpEntity<>(code, headers),
                RuffDiagnostic[].class);

        if (result == null) {
            return List.of();
        }
        return Arrays.stream(result).map(this::toIssue).toList();
    }

    private LintIssue toIssue(RuffDiagnostic d) {
        boolean error = d.code() == null
                || d.code().startsWith("E9")
                || d.code().equals("F821");

        return new LintIssue(
                d.location().row(), d.location().column(),
                d.endLocation().row(), d.endLocation().column(),
                d.code(), d.message(),
                error ? "error" : "warning");
    }
}