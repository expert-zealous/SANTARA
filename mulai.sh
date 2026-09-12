#!/usr/bin/env bash
# Menjalankan SANTARA
cd "$(dirname "$0")"
PORT=${PORT:-3000} node server.js
