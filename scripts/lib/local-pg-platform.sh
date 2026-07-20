#!/usr/bin/env bash

# Funções puras/isoláveis usadas por setup-local-pg.sh. Mantê-las sem efeitos
# colaterais permite testar seleção de plataforma e o guard destrutivo.
local_pg_has_debian_cluster() {
  command -v pg_ctlcluster >/dev/null 2>&1
}

local_pg_validate_reset_target() {
  local target_real
  local tmp_root_real
  target_real="$(CDPATH= cd -P -- "$1" 2>/dev/null && pwd -P)" || return 1
  tmp_root_real="$(CDPATH= cd -P -- "$2" 2>/dev/null && pwd -P)" || return 1
  [ "$target_real" != "$tmp_root_real" ] || return 1
  case "$target_real" in
    "$tmp_root_real"/*) return 0 ;;
    *) return 1 ;;
  esac
}

local_pg_extension_dir() {
  local pg_bin="$1"
  printf '%s/extension\n' "$("$pg_bin/pg_config" --sharedir)"
}
