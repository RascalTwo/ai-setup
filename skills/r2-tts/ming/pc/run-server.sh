#!/bin/bash
# Foreground on purpose: the Scheduled Task's wsl.exe stays alive, and that keeps the WSL VM up.
cd "$(dirname "$0")" || exit 1
exec /root/ming/venv/bin/python ming_server.py >> server.log 2>&1
