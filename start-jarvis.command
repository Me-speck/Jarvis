#!/bin/bash
set -euo pipefail

cd -- "$(dirname "$0")"

usage() {
  echo "Usage: ./start-jarvis.command [--share [MAC_LOCAL_IPV4]]"
  echo "Start Jarvis on this Mac. Add --share to connect from ChromeOS or iPhone."
}

share=false
address=""
case "${1:-}" in
  "") ;;
  --help|-h) usage; exit 0 ;;
  --share) share=true; address="${2:-}"; shift ;;
  *) usage >&2; exit 2 ;;
esac
if (( $# > 1 )); then usage >&2; exit 2; fi

if [[ "$(uname -s)" != Darwin ]]; then
  echo "This launcher is for macOS. On other systems, follow the README." >&2
  exit 1
fi

for prefix in /opt/homebrew /usr/local; do
  if [[ -x "$prefix/bin/brew" ]]; then
    export PATH="$prefix/bin:$PATH"
    break
  fi
done
if ! command -v brew >/dev/null; then
  echo "Install Homebrew from https://brew.sh/ on this Mac, then run this launcher again." >&2
  exit 1
fi
if ! xcode-select -p >/dev/null 2>&1; then
  echo "Run xcode-select --install to install Apple's command line tools, then try again." >&2
  exit 1
fi

packages=(python@3.12 ffmpeg cmake)
if $share; then packages+=(caddy); fi
for package in "${packages[@]}"; do
  if ! brew list --versions "$package" >/dev/null; then brew install "$package"; fi
done
if [[ ! -x .venv/bin/python ]]; then
  "$(brew --prefix python@3.12)/bin/python3.12" -m venv .venv
fi
python="$PWD/.venv/bin/python"

# Reinstall dependencies when their declarations change.
dependency_stamp="$(
  shasum -a 256 requirements.txt requirements-voice.txt requirements-model.txt
)"
if [[ ! -f .venv/jarvis-dependencies ]] || [[ "$(cat .venv/jarvis-dependencies)" != "$dependency_stamp" ]]; then
  "$python" -m pip install -r requirements.txt -r requirements-voice.txt -r requirements-model.txt
  printf '%s\n' "$dependency_stamp" > .venv/jarvis-dependencies
fi
"$python" scripts/download_models.py

export JARVIS_HOST=127.0.0.1
export JARVIS_PORT="${JARVIS_PORT:-8765}"
if ! "$python" -c 'import sys; port = int(sys.argv[1]); sys.exit(not (1024 <= port <= 65535))' "$JARVIS_PORT"; then
  echo "Choose a JARVIS_PORT between 1024 and 65535." >&2
  exit 2
fi
local_url="http://localhost:$JARVIS_PORT"
if ! "$python" -c 'import socket, sys; s = socket.socket(); s.bind(("127.0.0.1", int(sys.argv[1])))' "$JARVIS_PORT"; then
  echo "Port $JARVIS_PORT is in use. Close the other server or choose a different JARVIS_PORT." >&2
  exit 1
fi

config=""
if $share; then
  if [[ -z "$address" ]]; then
    interface="$(route -n get default 2>/dev/null | awk '/interface:/ {print $2}')" || true
    if [[ -n "$interface" ]]; then address="$(ipconfig getifaddr "$interface" 2>/dev/null)" || true; fi
  fi
  if ! "$python" -c 'import ipaddress, sys
try:
    ip = ipaddress.IPv4Address(sys.argv[1])
except ValueError:
    sys.exit(1)
sys.exit(ip.is_loopback or ip.is_unspecified or ip.is_multicast or sys.argv[1] == "255.255.255.255")' "$address"; then
    echo "Pass the Mac’s Wi-Fi IPv4 address, for example ./start-jarvis.command --share 192.168.1.23" >&2
    exit 2
  fi
  config="$(mktemp "${TMPDIR:-/tmp}/jarvis-caddy.XXXXXX")"
  # Keep the same certificate authority across launches and keep it out of Git.
  export XDG_DATA_HOME="$HOME/Library/Application Support/Jarvis"
  mkdir -p "$XDG_DATA_HOME"
  cat > "$config" <<EOF
{
    admin off
    auto_https disable_redirects
    skip_install_trust
}
https://$address:8443 {
    bind $address
    tls internal
    reverse_proxy 127.0.0.1:$JARVIS_PORT
}
EOF
fi

server_pid=""
proxy_pid=""
cleanup() {
  if [[ -n "$proxy_pid" ]]; then kill "$proxy_pid" 2>/dev/null || true; fi
  if [[ -n "$server_pid" ]]; then kill "$server_pid" 2>/dev/null || true; fi
  if [[ -n "$config" ]]; then rm -f -- "$config"; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

"$python" -B app.py &
server_pid=$!
ready=false
for attempt in {1..30}; do
  if ! kill -0 "$server_pid" 2>/dev/null; then break; fi
  if curl -fsS --noproxy '*' --max-time 1 "http://127.0.0.1:$JARVIS_PORT/health" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if ! $ready; then
  echo "Jarvis failed to start. Check the startup output above." >&2
  exit 1
fi

echo "Jarvis on this Mac: $local_url"
if $share; then
  caddy_data="$(caddy environ | sed -n 's/^caddy\.AppDataDir=//p')"
  echo "Jarvis on Chromebook or iPhone: https://$address:8443"
  echo "Public certificate to transfer: $caddy_data/pki/authorities/local/root.crt"
  echo "Leave this window open. Press Control-C to stop sharing."
  caddy run --config "$config" --adapter caddyfile &
  proxy_pid=$!
fi
open "$local_url" || true

if $share; then wait "$proxy_pid"; else wait "$server_pid"; fi
