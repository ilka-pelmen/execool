#!/usr/bin/env bash
# Запускает агента, бэкенд и прокси в одном контейнере.
# Если один из процессов завершился, останавливаем остальные и выходим с тем же кодом:
# контейнер должен упасть целиком, а не работать наполовину.
set -u

pids=()

stop_all() {
  for pid in "${pids[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}

# docker stop присылает SIGTERM процессу с PID 1: передаём его дочерним процессам.
trap 'stop_all; exit 143' TERM INT

execool-agent &
pids+=($!)

# Память делится между процессами, поэтому Java получает меньше, чем в отдельном образе.
java -XX:ActiveProcessorCount=1 -XX:MaxRAMPercentage=50 -XX:+UseSerialGC -XX:TieredStopAtLevel=1 -jar /app/app.jar &
pids+=($!)

java -XX:ActiveProcessorCount=1 -XX:MaxRAMPercentage=50 -XX:+UseSerialGC -XX:TieredStopAtLevel=1 -jar /app/app.jar &
java_pid=$!
pids+=("$java_pid")

# Ждем, пока бэкенд откроется
deadline=$((SECONDS + 180))
until (exec 3<>/dev/tcp/127.0.0.1/6767) 2>/dev/null; do
  if ! kill -0 "$java_pid" 2>/dev/null || [ "$SECONDS" -ge "$deadline" ]; then
    echo "backend не готов за отведённое время" >&2
    stop_all
    exit 1
  fi
  sleep 1
done

caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
pids+=($!)

wait -n
status=$?
stop_all
exit "$status"
