#!/usr/bin/env bash
#
# build-release.sh — единственный способ обновить releases/
#
# Пакует загружаемое расширение из sources/citp-zayavka/ в
# releases/citp-zayavka_v<версия>.zip. Версия берётся из manifest.json.
# manifest.json оказывается в КОРНЕ архива (требование Chrome Web Store /
# «загрузить распакованное расширение»).
#
# Правила проекта:
#   - Все правки — только в sources/citp-zayavka/.
#   - releases/ руками не трогать: этот скрипт — единственный способ его обновить.
#   - Версию поднимать в sources/citp-zayavka/manifest.json ПЕРЕД сборкой.
#
set -euo pipefail

# Корень репозитория = каталог на уровень выше tools/
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/sources/citp-zayavka"
OUTDIR="$ROOT/releases"
NAME="citp-zayavka"

MANIFEST="$SRC/manifest.json"
if [[ ! -f "$MANIFEST" ]]; then
  echo "ОШИБКА: не найден $MANIFEST" >&2
  exit 1
fi

# Достаём "version": "X.Y.Z" без внешних зависимостей (без jq)
VERSION="$(grep -oE '"version"[[:space:]]*:[[:space:]]*"[^"]+"' "$MANIFEST" \
  | head -n1 | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
if [[ -z "${VERSION:-}" ]]; then
  echo "ОШИБКА: не удалось прочитать version из manifest.json" >&2
  exit 1
fi

OUT="$OUTDIR/${NAME}_v${VERSION}.zip"
mkdir -p "$OUTDIR"

# Пересобираем ровно текущую версию; прочие версии в releases/ не трогаем.
rm -f "$OUT"

# Пакуем СОДЕРЖИМОЕ src (manifest.json в корне архива).
# Исключаем мусор ОС и любые доки — в релиз идёт только чистое расширение.
(
  cd "$SRC"
  zip -rX "$OUT" . \
    -x '*.DS_Store' -x '__MACOSX*' -x '*Thumbs.db' -x '*.md' >/dev/null
)

SIZE="$(du -h "$OUT" | cut -f1)"
echo "Готово: releases/${NAME}_v${VERSION}.zip (${SIZE})"
