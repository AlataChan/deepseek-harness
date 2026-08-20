#!/bin/sh
basedir=$(dirname "$(echo "$0" | sed -e 's,\\,/,g')")
exec node "$basedir/../node_modules/@deepseek-ai/dsh/lib/bin.js" "$@"
