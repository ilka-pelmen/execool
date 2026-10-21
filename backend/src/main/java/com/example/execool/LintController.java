package com.example.execool;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/lint")
public class LintController {

    private static final Logger log = LoggerFactory.getLogger(LintController.class);
    private static final int MAX_CODE_CHARS = 200_000;

    public record LintRequest(String code) {}

    private final LintService lintService;

    public LintController(LintService lintService) {
        this.lintService = lintService;
    }

    @PostMapping
    public ResponseEntity<Object> lint(@RequestBody LintRequest request) {
        if (request == null || request.code() == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "code is required"));
        }
        if (request.code().length() > MAX_CODE_CHARS) {
            return ResponseEntity.status(413).body(Map.of("error", "code is too large"));
        }

        try {
            return ResponseEntity.ok(lintService.lint(request.code()));
        } catch (Exception e) {
            log.warn("Lint request failed: {}", e.getMessage());
            return ResponseEntity.status(502).body(Map.of("error", "lint service unavailable"));
        }
    }
}