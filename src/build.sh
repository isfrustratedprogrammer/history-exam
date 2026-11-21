#!/usr/bin/env bash
# Собирает страницу из src/: artifact.html (содержимое для публикации на claude.ai)
# и index.html (самостоятельный файл: открыть в браузере или выложить на любой хостинг).
set -euo pipefail
src="$(cd "$(dirname "$0")" && pwd)"
out="$(dirname "$src")"

scripts() {
  printf '<script>\nconst TOPICS = [];\n'
  cat "$src"/topics-0*.js
  cat "$src/app.js"
  printf '</script>\n'
}

{
  sed '/<!--DATA-->/,$d' "$src/shell.html"
  scripts
} > "$out/artifact.html"

{
  printf '<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n'
  printf '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
  sed -n '1,/<\/style>/p' "$src/shell.html"
  printf '</head>\n<body>\n'
  sed '1,/<\/style>/d' "$src/shell.html" | sed '/<!--DATA-->/,$d'
  scripts
  printf '</body>\n</html>\n'
} > "$out/index.html"

echo "artifact.html: $(wc -c < "$out/artifact.html") байт"
echo "index.html:    $(wc -c < "$out/index.html") байт"
