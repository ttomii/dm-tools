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
BUILD_DIR="${PREVIEW_DIR}"

print_usage() {
  cat <<EOF
Usage: $(basename "${BASH_SOURCE[0]}") [OPTIONS]

Build a Windows x64 distribution from WSL/Linux.

Options:
  --build-dir DIR  Use DIR for Bun's temporary build files.
                   The distribution is still written to ${DIST_DIR}.
  -h, --help       Show this help.
EOF
}

parse_args() {
  while (($# > 0)); do
    case "$1" in
      --build-dir)
        if (($# < 2)) || [[ -z "$2" ]]; then
          echo "Missing argument for --build-dir" >&2
          print_usage >&2
          exit 2
        fi
        BUILD_DIR="$2"
        shift 2
        ;;
      --build-dir=*)
        BUILD_DIR="${1#*=}"
        if [[ -z "${BUILD_DIR}" ]]; then
          echo "Missing argument for --build-dir" >&2
          print_usage >&2
          exit 2
        fi
        shift
        ;;
      -h|--help)
        print_usage
        exit 0
        ;;
      *)
        echo "Unknown option: $1" >&2
        print_usage >&2
        exit 2
        ;;
    esac
  done
}

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

clean_build_outputs() {
  echo "Cleaning previous build outputs..."
  rm -rf "${CONVERTER_DIR}/target" "${PREVIEW_DIR}/dist" "${DIST_DIR}"
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

  mkdir -p -- "${BUILD_DIR}"
  if [[ ! -d "${BUILD_DIR}" || ! -w "${BUILD_DIR}" || ! -x "${BUILD_DIR}" ]]; then
    echo "Build directory is not accessible: ${BUILD_DIR}" >&2
    exit 1
  fi

  local bun_work_dir
  local bun_build_status=0
  local build_dir_without_trailing_slash="${BUILD_DIR%/}"
  if [[ -z "${build_dir_without_trailing_slash}" ]]; then
    build_dir_without_trailing_slash="/"
  fi
  bun_work_dir="$(mktemp -d -- "${build_dir_without_trailing_slash}/.dm-preview-build.XXXXXX")"

  (
    cd "${bun_work_dir}"
    bun build \
      --compile \
      --target="${BUN_TARGET}" \
      "${PREVIEW_DIR}/bin/dm-preview.js" \
      --outfile "${PREVIEW_DIR}/dist/dm-preview.exe"
  ) || bun_build_status=$?
  rm -rf -- "${bun_work_dir}"

  if ((bun_build_status != 0)); then
    return "${bun_build_status}"
  fi

  (
    cd "${PREVIEW_DIR}"
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
  parse_args "$@"
  add_bun_to_path
  require_prerequisites
  clean_build_outputs
  build_converter
  build_preview
  create_archive
  echo "Created ${ARCHIVE_PATH}"
}

main "$@"
