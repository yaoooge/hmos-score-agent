#!/usr/bin/env bash
set -Eeuo pipefail

# 迁移历史本地用例产物到持久化数据目录，并重建 result risks 评测集。
# 默认面向服务器路径；所有路径和行为均可通过环境变量覆盖。

APP_DIR="${APP_DIR:-/opt/hmos-score-score}"
APP_USER="${APP_USER:-hmos}"
SERVICE_NAME="${SERVICE_NAME:-hmos-score-agent}"
OLD_LOCAL_CASE_ROOT="${OLD_LOCAL_CASE_ROOT:-${APP_DIR}/.local-cases}"
NEW_LOCAL_CASE_ROOT="${NEW_LOCAL_CASE_ROOT:-/data/hmos-score-agent/local-cases}"
HUMAN_REVIEW_EVIDENCE_ROOT="${HUMAN_REVIEW_EVIDENCE_ROOT:-/data/hmos-score-agent/human-review-evidences}"
DRY_RUN="${DRY_RUN:-false}"
SKIP_RESTART="${SKIP_RESTART:-false}"
SKIP_RISK_REBUILD="${SKIP_RISK_REBUILD:-false}"

log() {
  printf '[%s] %s\n' "$(date '+%F %T')" "$*"
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

need_command() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令：$1"
}

run_as_app_user() {
  if id "${APP_USER}" >/dev/null 2>&1; then
    sudo -H -u "${APP_USER}" "$@"
    return
  fi
  "$@"
}

upsert_env_var() {
  local env_file="$1"
  local key="$2"
  local value="$3"

  touch "${env_file}"
  if grep -q "^${key}=" "${env_file}"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "${env_file}"
  else
    printf '\n%s=%s\n' "${key}" "${value}" >>"${env_file}"
  fi
}

rewrite_remote_task_index_paths() {
  local index_file="${NEW_LOCAL_CASE_ROOT}/remote-task-index.json"
  if [[ ! -f "${index_file}" ]]; then
    log "未找到 remote-task-index.json，跳过索引路径重写"
    return
  fi

  local backup_file="${index_file}.$(date '+%Y%m%d%H%M%S').bak"
  cp "${index_file}" "${backup_file}"
  sed -i "s|${OLD_LOCAL_CASE_ROOT}|${NEW_LOCAL_CASE_ROOT}|g" "${index_file}"
  log "已重写 remote-task-index.json 中的 caseDir 路径，备份=${backup_file}"
}

rebuild_result_risk_evidence() {
  if [[ "${SKIP_RISK_REBUILD}" == "true" ]]; then
    log "跳过 result risks 评测集重建 SKIP_RISK_REBUILD=true"
    return
  fi

  log "构建项目并重建 result risks 评测集"
  run_as_app_user npm --prefix "${APP_DIR}" run build
  (
    cd "${APP_DIR}"
    run_as_app_user env \
      LOCAL_CASE_ROOT="${NEW_LOCAL_CASE_ROOT}" \
      HUMAN_REVIEW_EVIDENCE_ROOT="${HUMAN_REVIEW_EVIDENCE_ROOT}" \
      node dist/tools/rebuildResultRiskEvidence.js
  )
}

restart_service() {
  if [[ "${SKIP_RESTART}" == "true" ]]; then
    log "跳过服务重启 SKIP_RESTART=true"
    return
  fi
  need_command systemctl
  systemctl restart "${SERVICE_NAME}"
  log "已重启服务：${SERVICE_NAME}"
}

main() {
  need_command rsync
  need_command sed
  need_command npm
  need_command node

  [[ -d "${APP_DIR}" ]] || die "工程目录不存在：${APP_DIR}"
  [[ -d "${OLD_LOCAL_CASE_ROOT}" ]] || die "历史用例目录不存在：${OLD_LOCAL_CASE_ROOT}"

  log "迁移配置 APP_DIR=${APP_DIR}"
  log "历史目录 OLD_LOCAL_CASE_ROOT=${OLD_LOCAL_CASE_ROOT}"
  log "目标目录 NEW_LOCAL_CASE_ROOT=${NEW_LOCAL_CASE_ROOT}"
  log "评测集目录 HUMAN_REVIEW_EVIDENCE_ROOT=${HUMAN_REVIEW_EVIDENCE_ROOT}"

  mkdir -p "${NEW_LOCAL_CASE_ROOT}" "${HUMAN_REVIEW_EVIDENCE_ROOT}"

  local rsync_args=(-a --ignore-existing)
  if [[ "${DRY_RUN}" == "true" ]]; then
    rsync_args+=(--dry-run --itemize-changes)
    log "DRY_RUN=true，仅预览迁移，不修改文件"
  fi
  rsync "${rsync_args[@]}" "${OLD_LOCAL_CASE_ROOT}/" "${NEW_LOCAL_CASE_ROOT}/"

  if [[ "${DRY_RUN}" == "true" ]]; then
    log "DRY_RUN 完成，未更新 .env、索引、权限、评测集或服务"
    return
  fi

  rewrite_remote_task_index_paths

  local env_file="${APP_DIR}/.env"
  upsert_env_var "${env_file}" "LOCAL_CASE_ROOT" "${NEW_LOCAL_CASE_ROOT}"
  upsert_env_var "${env_file}" "HUMAN_REVIEW_EVIDENCE_ROOT" "${HUMAN_REVIEW_EVIDENCE_ROOT}"

  if id "${APP_USER}" >/dev/null 2>&1; then
    chown -R "${APP_USER}:${APP_USER}" "${NEW_LOCAL_CASE_ROOT}" "${HUMAN_REVIEW_EVIDENCE_ROOT}" "${env_file}"
  fi

  rebuild_result_risk_evidence
  restart_service

  log "迁移完成。历史目录未删除：${OLD_LOCAL_CASE_ROOT}"
  log "验证结果接口示例：curl http://127.0.0.1:3000/score/remote-tasks/<taskId>/result"
}

main "$@"
