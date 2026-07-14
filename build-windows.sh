#!/usr/bin/env bash

# Build a Windows x64 distribution from WSL/Linux.
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly TARGET="x86_64-pc-windows-gnu"
readonly BUN_TARGET="bun-windows-x64-baseline"
readonly DIST_DIR="${SCRIPT_DIR}/dist"
readonly PACKAGE_NAME="dm-tools-windows-x64"
readonly PACKAGE_DIR="${DIST_DIR}/${PACKAGE_NAME}"
readonly ARCHIVE_PATH="${DIST_DIR}/${PACKAGE_NAME}.zip"
readonly TEMP_ARCHIVE_PATH="${DIST_DIR}/.${PACKAGE_NAME}.zip.tmp"
readonly CONVERTER_DIR="${SCRIPT_DIR}/dm-converter"
readonly PREVIEW_DIR="${SCRIPT_DIR}/dm-preview"

add_bun_to_path() {
  local bun_install_dir="${BUN_INSTALL:-${HOME}/.bun}"

  if ! command -v bun >/dev/null 2>&1 && [[ -x "${bun_install_dir}/bin/bun" ]]; then
    export PATH="${bun_install_dir}/bin:${PATH}"
  fi
}

require_command() {
  local command_name="$1"
  local install_hint="$2"

  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Missing required command: ${command_name}" >&2
    echo "${install_hint}" >&2
    exit 1
  fi
}

require_prerequisites() {
  require_command cargo "Install Rust 1.88 or later: https://rustup.rs/"
  require_command rustup "Install Rustup: https://rustup.rs/"
  require_command x86_64-w64-mingw32-gcc "Install MinGW-w64: sudo apt install gcc-mingw-w64-x86-64"
  require_command x86_64-w64-mingw32-ar "Install MinGW-w64: sudo apt install gcc-mingw-w64-x86-64"
  require_command node "Install Node.js 22 or later."
  require_command npm "Install Node.js 22 or later."
  require_command bun "Install Bun: https://bun.sh/docs/installation"
  require_command zip "Install zip: sudo apt install zip"

  if ! rustup target list --installed | grep -Fxq "${TARGET}"; then
    echo "Missing Rust target: ${TARGET}" >&2
    echo "Install it with: rustup target add ${TARGET}" >&2
    exit 1
  fi
}

build_converter() {
  echo "Building dm-converter for Windows x64..."
  (
    cd "${CONVERTER_DIR}"
    cargo build --target "${TARGET}" --release
  )
}

build_preview() {
  echo "Building dm-preview for Windows x64..."
  npm ci --prefix "${PREVIEW_DIR}" --no-audit --no-fund
  (
    cd "${PREVIEW_DIR}"
    bun build --compile --target="${BUN_TARGET}" bin/dm-preview.js --outfile dist/dm-preview.exe
    node scripts/build.mjs
  )
}

create_archive() {
  local converter_binary="${CONVERTER_DIR}/target/${TARGET}/release/dm-converter.exe"
  local preview_binary="${PREVIEW_DIR}/dist/dm-preview.exe"

  if [[ ! -f "${converter_binary}" || ! -f "${preview_binary}" ]]; then
    echo "Expected Windows binaries were not created." >&2
    exit 1
  fi

  echo "Packaging ${ARCHIVE_PATH}..."
  rm -rf "${PACKAGE_DIR}"
  rm -f "${ARCHIVE_PATH}" "${TEMP_ARCHIVE_PATH}"
  mkdir -p "${PACKAGE_DIR}/dm-preview"

  cp "${converter_binary}" "${PACKAGE_DIR}/dm-converter.exe"
  cp -R "${PREVIEW_DIR}/dist/." "${PACKAGE_DIR}/dm-preview/"
  cp "${SCRIPT_DIR}/README-WINDOWS.md" "${PACKAGE_DIR}/README.md"
  cp "${SCRIPT_DIR}/LICENSE" "${PACKAGE_DIR}/"
  cp "${PREVIEW_DIR}/THIRD_PARTY_LICENSES" "${PACKAGE_DIR}/THIRD_PARTY_LICENSES-dm-preview.txt"

  (
    cd "${DIST_DIR}"
    zip -qr "${TEMP_ARCHIVE_PATH}" "${PACKAGE_NAME}"
  )
  mv "${TEMP_ARCHIVE_PATH}" "${ARCHIVE_PATH}"
}

main() {
  add_bun_to_path
  require_prerequisites
  build_converter
  build_preview
  create_archive
  echo "Created ${ARCHIVE_PATH}"
}

main "$@"
