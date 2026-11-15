#!/bin/bash

stop_all() {
  kill $(jobs -p) 2>/dev/null
  wait 2>/dev/null
}

trap 'stop_all; exit 143' TERM INT

# Ждём, пока порт начнёт принимать соединения.
# Если процесс умер раньше, завершаем всё и выходим с ошибкой.
wait_port() {
  local port=$1 name=$2 pid=$3 timeout=${4:-180}
  local i=0
  until (exec 3<>/dev/tcp/127.0.0.1/"$port") 2>/dev/null; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "$name завершился до готовности" >&2
      stop_all
      exit 1
    fi
    i=$((i + 1))
    if [ "$i" -ge "$timeout" ]; then
      echo "$name не открыл порт $port за ${timeout}с" >&2
      stop_all
      exit 1
    fi
    sleep 1
  done
  echo "$name готов на порту $port"
}

execool-agent &
AGENT_PID=$!

java -XX:MaxRAMPercentage=50 -jar /app/app.jar &
JAVA_PID=$!

wait_port "${AGENT_PORT:-6721}" agent "$AGENT_PID"
wait_port "${SERVER_PORT:-6767}" backend "$JAVA_PID" 300

caddy run &
CADDY_PID=$!

# Дальше остаётся ваша логика: если любой процесс завершился, останавливаем остальные.
wait -n
status=$?
echo "entrypoint: один из процессов завершился с кодом $status" >&2
stop_all
exit $status
