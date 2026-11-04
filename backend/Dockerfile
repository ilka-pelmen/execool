# Один образ: бэкенд на Spring и собранный фронтенд внутри него.
# Сборка из КОРНЯ репозитория (там лежат frontend/ и backend/):
#   docker build -f backend/Dockerfile -t execool .

# 1. Фронтенд
FROM docker.io/library/node:22-slim AS frontend
WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Без Pyodide в сборке приложение откроется, но Python не запустится.
RUN test -f dist/pyodide/pyodide.mjs || { \
      echo "Нет dist/pyodide: положите рантайм в frontend/public/pyodide (scripts/copy-pyodide.mjs)"; \
      exit 1; \
    }

# 2. Бэкенд
FROM docker.io/library/maven:3.9-eclipse-temurin-17 AS build
WORKDIR /app

COPY backend/pom.xml ./
RUN mvn -B -q dependency:go-offline

COPY backend/src ./src
# Spring отдаёт всё из classpath:/static как есть, index.html открывается на "/".
COPY --from=frontend /app/dist ./src/main/resources/static
RUN mvn -B -q -DskipTests package

RUN set -eu; \
    set -- $(find target -maxdepth 1 -type f -name '*.jar' \
      ! -name '*-sources.jar' \
      ! -name '*-javadoc.jar' \
      ! -name '*-tests.jar'); \
    [ "$#" -eq 1 ] || { echo "Expected exactly one application JAR, found $#"; exit 1; }; \
    mkdir -p /out; \
    cp "$1" /out/app.jar

# 3. Запуск
FROM docker.io/library/ibm-semeru-runtimes:open-17-jre-noble
RUN groupadd --system app && useradd --system --gid app --home-dir /app app
WORKDIR /app

COPY --from=build --chown=app:app /out/app.jar /app/app.jar

USER app
EXPOSE 6767
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/app.jar"]