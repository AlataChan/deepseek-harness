#!/usr/bin/env pwsh
$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent
& "$basedir/node.exe" "$basedir/../node_modules/@deepseek-ai/dsh/lib/bin.js" $args
