#!/usr/bin/env bash
set -euo pipefail

action="${1:-}"
fqdn="${2:-}"
remote_port="${3:-}"
sites_directory="${4:-}"
caddy_config_path="${5:-}"
public_ip="${6:-}"

target_file="${sites_directory%/}/${fqdn}.caddy"
backup_directory="${sites_directory%/}/.frpc-desktop-backups"
backup_file=""
had_target="no"

emit() {
  printf '%s=%s\n' "$1" "$2"
}

reload_caddy() {
  systemctl reload caddy 2>/dev/null || systemctl restart caddy
  systemctl is-active --quiet caddy
}

restore_target() {
  if [[ "$had_target" == "yes" && -n "$backup_file" && -f "$backup_file" ]]; then
    cp "$backup_file" "$target_file"
    chmod 644 "$target_file"
  else
    rm -f "$target_file"
  fi
  systemctl restart caddy >/dev/null 2>&1 || true
}

write_target() {
  mkdir -p "$sites_directory" "$backup_directory"
  local temporary_file
  temporary_file="$(mktemp "${sites_directory%/}/.${fqdn}.XXXXXX")"
  trap 'rm -f "$temporary_file"' RETURN
  printf '%s {\n\tencode zstd gzip\n\treverse_proxy 127.0.0.1:%s\n}\n' \
    "$fqdn" "$remote_port" >"$temporary_file"
  caddy fmt --overwrite "$temporary_file" >/dev/null
  chmod 644 "$temporary_file"
  if [[ -f "$target_file" ]] && cmp -s "$temporary_file" "$target_file"; then
    rm -f "$temporary_file"
    trap - RETURN
    return
  fi
  if [[ -f "$target_file" ]]; then
    had_target="yes"
    backup_file="${backup_directory}/${fqdn}.$(date -u +%Y%m%dT%H%M%SZ).caddy"
    cp "$target_file" "$backup_file"
    chmod 600 "$backup_file"
  fi
  mv "$temporary_file" "$target_file"
  trap - RETURN
}

validate_loaded_site() {
  caddy validate --config "$caddy_config_path" >/dev/null
  caddy adapt --config "$caddy_config_path" 2>/dev/null | grep -Fq "$fqdn"
}

backend_status() {
  curl --silent --show-error --output /dev/null \
    --write-out '%{http_code}' --max-time 10 \
    "http://127.0.0.1:${remote_port}"
}

case "$action" in
  deploy)
    status="$(backend_status)" || {
      emit RESULT FAIL
      emit ERROR FRP_BACKEND_UNREACHABLE
      exit 20
    }
    if [[ "$status" == "000" ]]; then
      emit RESULT FAIL
      emit ERROR FRP_BACKEND_UNREACHABLE
      exit 20
    fi

    write_target
    if ! validate_loaded_site; then
      restore_target
      emit RESULT FAIL
      emit ERROR CADDY_VALIDATE_OR_IMPORT_FAILED
      exit 21
    fi
    if ! reload_caddy; then
      restore_target
      emit RESULT FAIL
      emit ERROR CADDY_RELOAD_FAILED
      exit 22
    fi
    emit RESULT PASS
    emit BACKEND_STATUS "$status"
    emit CONFIG_FILE "$target_file"
    emit BACKUP_FILE "${backup_file:-none}"
    emit CADDY_STATUS active
    ;;
  remove)
    mkdir -p "$backup_directory"
    if [[ ! -f "$target_file" ]]; then
      emit RESULT PASS
      emit CONFIG_FILE "$target_file"
      emit BACKUP_FILE none
      emit CADDY_STATUS "$(systemctl is-active caddy 2>/dev/null || true)"
      exit 0
    fi

    had_target="yes"
    backup_file="${backup_directory}/${fqdn}.$(date -u +%Y%m%dT%H%M%SZ).removed.caddy"
    mv "$target_file" "$backup_file"
    chmod 600 "$backup_file"
    if ! caddy validate --config "$caddy_config_path" >/dev/null; then
      mv "$backup_file" "$target_file"
      chmod 644 "$target_file"
      emit RESULT FAIL
      emit ERROR CADDY_VALIDATE_FAILED_AFTER_REMOVE
      exit 23
    fi
    if ! reload_caddy; then
      mv "$backup_file" "$target_file"
      chmod 644 "$target_file"
      systemctl restart caddy >/dev/null 2>&1 || true
      emit RESULT FAIL
      emit ERROR CADDY_RELOAD_FAILED_AFTER_REMOVE
      exit 24
    fi
    emit RESULT PASS
    emit CONFIG_FILE "$target_file"
    emit BACKUP_FILE "$backup_file"
    emit CADDY_STATUS active
    ;;
  status)
    backend="000"
    backend="$(backend_status 2>/dev/null)" || true
    dns_ready="no"
    if command -v dig >/dev/null 2>&1 && dig +short "$fqdn" | grep -Fxq "$public_ip"; then
      dns_ready="yes"
    fi
    config_ready="no"
    if [[ -f "$target_file" ]] &&
      grep -Fq "$fqdn" "$target_file" &&
      grep -Fq "reverse_proxy 127.0.0.1:${remote_port}" "$target_file"; then
      config_ready="yes"
    fi
    caddy_status="$(systemctl is-active caddy 2>/dev/null || true)"
    https_status="000"
    if [[ "$dns_ready" == "yes" ]]; then
      https_status="$(curl --silent --show-error --output /dev/null \
        --write-out '%{http_code}' --max-time 15 "https://${fqdn}" 2>/dev/null || true)"
    fi
    emit RESULT PASS
    emit BACKEND_STATUS "$backend"
    emit DNS_READY "$dns_ready"
    emit CONFIG_READY "$config_ready"
    emit CADDY_STATUS "$caddy_status"
    emit HTTPS_STATUS "$https_status"
    emit CONFIG_FILE "$target_file"
    ;;
  *)
    emit RESULT FAIL
    emit ERROR INVALID_ACTION
    exit 2
    ;;
esac
