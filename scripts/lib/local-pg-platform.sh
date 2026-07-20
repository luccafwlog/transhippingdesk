#!/usr/bin/env bash

# Funções puras/isoláveis usadas por setup-local-pg.sh. Mantê-las sem efeitos
# colaterais permite testar seleção de plataforma e o guard destrutivo.
local_pg_has_debian_cluster() {
  command -v pg_ctlcluster >/dev/null 2>&1
}

local_pg_validate_reset_target() {
  local target="$1"
  local tmp_root="${2%/}"
  case "$target" in
    "$tmp_root"/*) return 0 ;;
    *) return 1 ;;
  esac
}

local_pg_extension_dir() {
  local pg_bin="$1"
  printf '%s/extension\n' "$("$pg_bin/pg_config" --sharedir)"
}
