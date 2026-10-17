package com.example.execool;

import org.springframework.stereotype.Service;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.Stream;

@Service
public class SessionWorkspaceService {

    private final Path rootSessionsDir = Paths.get(System.getProperty("java.io.tmpdir"), "execool-sessions");

    public boolean sessionExists(String sessionId) {
        Path sessionDir = rootSessionsDir.resolve(sessionId);
        return Files.exists(sessionDir) && Files.isDirectory(sessionDir);
    }

    public String createSessionWorkspace(String projectId, String userId) {
        try {
            String sessionId = UUID.randomUUID().toString();
            Path sessionDir = rootSessionsDir.resolve(sessionId);
            Files.createDirectories(sessionDir);
            System.out.println("[Backend VFS] Создано чистое виртуальное пространство: " + sessionId);
            return sessionId;
        } catch (IOException e) {
            System.err.println("[Backend Error] Не удалось создать рабочее пространство: " + e.getMessage());
            return null; // Возвращаем null вместо падения
        }
    }

    /**
     * Безопасный виртуальный резолвер. Если путь некорректный или ведет за пределы — вернет null.
     */
    private Path resolveVirtualPath(Path sessionDir, String filePath) {
        if (filePath == null || filePath.isBlank()) {
            return null;
        }

        Path currentPath = sessionDir;
        String cleanPath = filePath.replace('\\', '/');
        
        for (String segment : cleanPath.split("/")) {
            if (segment.isEmpty() || segment.equals(".")) {
                continue;
            }
            if (segment.equals("..")) {
                return null; // Блокируем побег без исключений
            }
            currentPath = currentPath.resolve(segment);
        }

        Path normalizedSessionDir = sessionDir.normalize();
        Path normalizedTarget = currentPath.normalize();
        
        if (!normalizedTarget.startsWith(normalizedSessionDir)) {
            return null; // Выход за границы песочницы пресекаем
        }

        return normalizedTarget;
    }

    public boolean saveFile(String sessionId, String filePath, String content) {
        try {
            Path sessionDir = rootSessionsDir.resolve(sessionId);
            Path targetFile = resolveVirtualPath(sessionDir, filePath);
            
            if (targetFile == null) {
                return false; // Ошибка пути
            }

            if (targetFile.getParent() != null) {
                Files.createDirectories(targetFile.getParent());
            }

            Files.writeString(targetFile, content != null ? content : "");
            return true;
        } catch (IOException e) {
            System.err.println("[Backend Error] Ошибка записи файла: " + e.getMessage());
            return false;
        }
    }

    public String getFileContent(String sessionId, String filePath) {
        try {
            Path sessionDir = rootSessionsDir.resolve(sessionId);
            Path targetFile = resolveVirtualPath(sessionDir, filePath);
            
            if (targetFile == null || !Files.exists(targetFile) || !Files.isRegularFile(targetFile)) {
                return null; // Файл не найден или путь невалиден
            }

            return Files.readString(targetFile);
        } catch (IOException e) {
            System.err.println("[Backend Error] Ошибка чтения файла: " + e.getMessage());
            return null;
        }
    }

    public List<String> listFiles(String sessionId) {
        Path sessionDir = rootSessionsDir.resolve(sessionId);
        if (!Files.exists(sessionDir)) {
            return new ArrayList<>();
        }

        try (Stream<Path> walk = Files.walk(sessionDir)) {
            return walk.filter(Files::isRegularFile)
                    .map(sessionDir::relativize)
                    .map(Path::toString)
                    .map(p -> p.replace('\\', '/'))
                    .collect(Collectors.toList());
        } catch (IOException e) {
            System.err.println("[Backend Error] Ошибка обхода директории: " + e.getMessage());
            return new ArrayList<>();
        }
    }

    public void deleteSessionWorkspace(String sessionId) {
        try {
            Path sessionDir = rootSessionsDir.resolve(sessionId);
            if (Files.exists(sessionDir)) {
                try (var walk = Files.walk(sessionDir)) {
                    walk.sorted((a, b) -> b.compareTo(a))
                        .forEach(path -> {
                            try { Files.delete(path); } catch (IOException ignored) {}
                        });
                }
                System.out.println("[VFS] Пространство сессии очищено: " + sessionId);
            }
        } catch (Exception e) {
            System.err.println("[Backend Error] Ошибка удаления сессии: " + e.getMessage());
        }
    }
}