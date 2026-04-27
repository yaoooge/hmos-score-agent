#!/usr/bin/env bash
set -Eeuo pipefail

# 阿里云 ECS 单实例更新部署脚本。
# 前提：系统依赖、Node.js、opencode CLI 和工程目录均已安装/创建。
# 若运行用户不存在，脚本会自动创建并修正工程目录归属。
# 流程：拉取/更新代码仓 -> 生成缺失的 .env -> npm ci -> build -> 写入/重启 systemd -> 健康检查。
#
# 用法：
#   sudo bash scripts/aliyun-single-instance-deploy.sh
#
# 常用覆盖项：
#   sudo env BRANCH=main \
#     HMOS_OPENCODE_API_KEY=sk-xxx \
#     bash scripts/aliyun-single-instance-deploy.sh

APP_NAME="${APP_NAME:-hmos-score-agent}"
APP_USER="${APP_USER:-hmos}"
APP_DIR="${APP_DIR:-/opt/hmos-score-agent}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-3000}"

LOCAL_CASE_ROOT="${LOCAL_CASE_ROOT:-.local-cases}"
DEFAULT_REFERENCE_ROOT="${DEFAULT_REFERENCE_ROOT:-references/scoring}"
HMOS_OPENCODE_HOST="${HMOS_OPENCODE_HOST:-127.0.0.1}"
HMOS_OPENCODE_PORT="${HMOS_OPENCODE_PORT:-4096}"
HMOS_OPENCODE_PROVIDER_ID="${HMOS_OPENCODE_PROVIDER_ID:-bailian-coding-plan}"
HMOS_OPENCODE_MODEL_ID="${HMOS_OPENCODE_MODEL_ID:-glm-5}"
HMOS_OPENCODE_MODEL_NAME="${HMOS_OPENCODE_MODEL_NAME:-GLM-5}"
HMOS_OPENCODE_BASE_URL="${HMOS_OPENCODE_BASE_URL:-https://coding.dashscope.aliyuncs.com/apps/anthropic/v1}"
HMOS_OPENCODE_TIMEOUT_MS="${HMOS_OPENCODE_TIMEOUT_MS:-600000}"
HMOS_OPENCODE_MAX_OUTPUT_BYTES="${HMOS_OPENCODE_MAX_OUTPUT_BYTES:-1048576}"

log() {
  printf '\n[%s] %s\n' "$(date '+%F %T')" "$*"
}

die() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    die "请用 root 执行，例如：sudo bash $0"
  fi
}

need_command() {
  command -v "$1" >/dev/null 2>&1
}

run_as_app_user() {
  sudo -H -u "${APP_USER}" "$@"
}

check_existing_environment() {
  log "检查现有部署环境"
  for command_name in sudo git npm opencode systemctl curl; do
    if ! need_command "${command_name}"; then
      die "缺少命令：${command_name}。请先完成服务器基础安装。"
    fi
  done

  if ! id "${APP_USER}" >/dev/null 2>&1; then
    log "运行用户不存在，自动创建：${APP_USER}"
    useradd --system --create-home --shell /bin/bash "${APP_USER}"
  fi

  if [[ ! -d "${APP_DIR}/.git" ]]; then
    die "工程目录不是 git 仓库：${APP_DIR}。请先完成首次安装或确认 APP_DIR。"
  fi

  chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
}

checkout_code() {
  log "拉取/更新代码仓：${APP_DIR}#${BRANCH}"
  run_as_app_user git -C "${APP_DIR}" fetch origin "${BRANCH}"
  run_as_app_user git -C "${APP_DIR}" checkout "${BRANCH}"
  run_as_app_user git -C "${APP_DIR}" pull --ff-only origin "${BRANCH}"
}

prompt_value() {
  local var_name="$1"
  local prompt_text="$2"
  local default_value="$3"
  local secret="${4:-false}"
  local current_value="${!var_name:-}"

  if [[ -n "${current_value}" ]]; then
    return
  fi

  if [[ ! -t 0 ]]; then
    die "缺少 ${var_name}，非交互模式请通过环境变量传入"
  fi

  if [[ "${secret}" == "true" ]]; then
    read -r -s -p "${prompt_text}: " current_value
    printf '\n'
  else
    read -r -p "${prompt_text} [${default_value}]: " current_value
    current_value="${current_value:-${default_value}}"
  fi

  if [[ -z "${current_value}" ]]; then
    die "${var_name} 不能为空"
  fi
  printf -v "${var_name}" '%s' "${current_value}"
}

write_env_file() {
  local env_file="${APP_DIR}/.env"
  if [[ -f "${env_file}" ]]; then
    log ".env 已存在，跳过生成：${env_file}"
    return
  fi

  log "生成 .env"
  prompt_value HMOS_OPENCODE_MODEL_ID "请输入 HMOS_OPENCODE_MODEL_ID" "${HMOS_OPENCODE_MODEL_ID}"
  prompt_value HMOS_OPENCODE_MODEL_NAME "请输入 HMOS_OPENCODE_MODEL_NAME" "${HMOS_OPENCODE_MODEL_NAME}"
  prompt_value HMOS_OPENCODE_BASE_URL "请输入 HMOS_OPENCODE_BASE_URL" "${HMOS_OPENCODE_BASE_URL}"
  prompt_value HMOS_OPENCODE_API_KEY "请输入 HMOS_OPENCODE_API_KEY" "" true

  cat >"${env_file}" <<EOF
PORT=${PORT}
LOCAL_CASE_ROOT=${LOCAL_CASE_ROOT}
DEFAULT_REFERENCE_ROOT=${DEFAULT_REFERENCE_ROOT}
HMOS_OPENCODE_PORT=${HMOS_OPENCODE_PORT}
HMOS_OPENCODE_HOST=${HMOS_OPENCODE_HOST}
HMOS_OPENCODE_PROVIDER_ID=${HMOS_OPENCODE_PROVIDER_ID}
HMOS_OPENCODE_MODEL_ID=${HMOS_OPENCODE_MODEL_ID}
HMOS_OPENCODE_MODEL_NAME=${HMOS_OPENCODE_MODEL_NAME}
HMOS_OPENCODE_BASE_URL=${HMOS_OPENCODE_BASE_URL}
HMOS_OPENCODE_API_KEY=${HMOS_OPENCODE_API_KEY}
HMOS_OPENCODE_TIMEOUT_MS=${HMOS_OPENCODE_TIMEOUT_MS}
HMOS_OPENCODE_MAX_OUTPUT_BYTES=${HMOS_OPENCODE_MAX_OUTPUT_BYTES}
EOF
  chown "${APP_USER}:${APP_USER}" "${env_file}"
  chmod 600 "${env_file}"
}

install_app_dependencies() {
  log "安装项目依赖并构建"
  run_as_app_user npm --prefix "${APP_DIR}" ci
  run_as_app_user npm --prefix "${APP_DIR}" run build
}

write_systemd_service() {
  log "写入 systemd 服务"
  local npm_bin opencode_bin opencode_dir service_file
  npm_bin="$(command -v npm)"
  opencode_bin="$(command -v opencode)"
  opencode_dir="$(dirname "${opencode_bin}")"
  service_file="/etc/systemd/system/${APP_NAME}.service"

  cat >"${service_file}" <<EOF
[Unit]
Description=HMOS Score Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=PATH=${opencode_dir}:/usr/local/bin:/usr/bin:/bin
ExecStart=${npm_bin} start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "${APP_NAME}.service"
  systemctl restart "${APP_NAME}.service"
}

open_local_firewall() {
  if [[ "${SKIP_FIREWALL:-false}" == "true" ]]; then
    log "跳过系统防火墙配置"
    return
  fi

  if need_command firewall-cmd && systemctl is-active --quiet firewalld; then
    log "开放 firewalld 端口 ${PORT}/tcp"
    firewall-cmd --permanent --add-port="${PORT}/tcp"
    firewall-cmd --reload
    return
  fi

  if need_command ufw && ufw status | grep -q "Status: active"; then
    log "开放 ufw 端口 ${PORT}/tcp"
    ufw allow "${PORT}/tcp"
    return
  fi

  log "未检测到启用的 firewalld/ufw，跳过系统防火墙配置"
}

wait_for_health() {
  log "等待服务健康检查"
  local url="http://127.0.0.1:${PORT}/health"
  for _ in {1..30}; do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      log "服务已启动：${url}"
      return
    fi
    sleep 1
  done

  systemctl status "${APP_NAME}.service" --no-pager || true
  journalctl -u "${APP_NAME}.service" -n 100 --no-pager || true
  die "健康检查失败：${url}"
}

print_summary() {
  cat <<EOF

部署完成。

本机健康检查：
  curl http://127.0.0.1:${PORT}/health

公网健康检查：
  curl http://<ECS公网IP>:${PORT}/health

查看状态：
  systemctl status ${APP_NAME} --no-pager

查看日志：
  journalctl -u ${APP_NAME} -f

注意：还需要在阿里云 ECS 安全组入方向放行 ${PORT}/tcp，并建议只允许业务调用方 IP 访问。
EOF
}

main() {
  require_root
  check_existing_environment
  checkout_code
  write_env_file
  install_app_dependencies
  write_systemd_service
  open_local_firewall
  wait_for_health
  print_summary
}

main "$@"
