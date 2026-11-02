FROM docker.io/library/maven:3.9-eclipse-temurin-17 AS build
WORKDIR /app

COPY pom.xml ./
RUN mvn -B -q dependency:go-offline

COPY src ./src
RUN mvn -B -q -DskipTests package

RUN set -eu; \
    set -- $(find target -maxdepth 1 -type f -name '*.jar' \
      ! -name '*-sources.jar' \
      ! -name '*-javadoc.jar' \
      ! -name '*-tests.jar'); \
    [ "$#" -eq 1 ] || { echo "Expected exactly one application JAR, found $#"; exit 1; }; \
    mkdir -p /out; \
    cp "$1" /out/app.jar

FROM docker.io/library/ibm-semeru-runtimes:open-17-jre-noble
RUN groupadd --system app && useradd --system --gid app --home-dir /app app
WORKDIR /app

COPY --from=build --chown=app:app /out/app.jar /app/app.jar

USER app
EXPOSE 6767
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/app.jar"]
