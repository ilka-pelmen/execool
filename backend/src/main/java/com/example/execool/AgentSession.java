package com.example.execool;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonProperty;

public record AgentSession(
        @JsonProperty("session_id")
        @JsonAlias("id")
        String id,

        @JsonProperty("language")
        @JsonAlias("language_id")
        String language,

        @JsonProperty("root_uri")
        @JsonAlias("rootUri")
        String rootUri,

        AgentLimits limits
) {
    public record AgentLimits(
            @JsonProperty("max_files")
            @JsonAlias("maxFiles")
            int maxFiles,

            @JsonProperty("max_file_bytes")
            @JsonAlias("maxFileBytes")
            int maxFileBytes,

            @JsonProperty("max_total_bytes")
            @JsonAlias("maxTotalBytes")
            int maxTotalBytes
    ) {}
}
