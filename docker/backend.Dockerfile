# Бэкенд на Spring Boot со встроенным фронтендом: Spring сам отдаёт собранные файлы.
# Сборка из КОРНЯ репозитория:
#   docker build -f docker/backend.Dockerfile -t execool-backend .

# 1. Фронтенд (Pyodide копируется из npm-пакета скриптом prebuild)
FROM docker.io/library/node:22-slim AS frontend
WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Без Pyodide в сборке приложение откроется, но Python не запустится.
RUN test -f dist/pyodide/pyodide.mjs || { echo "В dist нет pyodide: проверьте scripts/copy-pyodide.mjs"; exit 1; }

# 2. Бэкенд: собранный фронтенд кладём в статические ресурсы Spring
FROM docker.io/library/maven:3.9-eclipse-temurin-17 AS build
WORKDIR /app

COPY backend/pom.xml ./
RUN mvn -B -q dependency:go-offline

COPY backend/src ./src
COPY --from=frontend /app/dist ./src/main/resources/static
RUN mvn -B -q -DskipTests package

RUN set -eu; \
    set -- $(find target -maxdepth 1 -type f -name '*.jar' \
      ! -name '*-sources.jar' \
      ! -name '*-javadoc.jar' \
      ! -name '*-tests.jar'); \
    [ "$#" -eq 1 ] || { echo "Ожидался один JAR приложения, найдено: $#"; exit 1; }; \
    mkdir -p /out; \
    cp "$1" /out/app.jar

# 3. Запуск
FROM docker.io/library/ibm-semeru-runtimes:open-17-jre-noble
RUN groupadd --system app && useradd --system --gid app --home-dir /app app
WORKDIR /app

COPY --from=build --chown=app:app /out/app.jar /app/app.jar

ENV SERVER_PORT=6767

USER app
EXPOSE 6767
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/app.jar"]
