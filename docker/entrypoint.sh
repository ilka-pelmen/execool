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
java -XX:MaxRAMPercentage=50 -jar /app/app.jar &
pids+=($!)

caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
pids+=($!)

wait -n
status=$?
stop_all
exit "$status"
