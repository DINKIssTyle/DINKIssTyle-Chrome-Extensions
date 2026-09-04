#!/bin/sh
set -eu

echo "==================================================="
echo "  AIAng Chrome -> Edge 자원 복사 및 동기화 스크립트"
echo "==================================================="

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
SOURCE_DIR="${REPO_ROOT}/Chrome/AIAng"
DEST_DIR="${REPO_ROOT}/Edge/AIAng"

if [ ! -f "${SOURCE_DIR}/manifest.json" ]; then
  echo "[ERROR] 크롬 확장 프로그램 원본 폴더를 찾을 수 없습니다: ${SOURCE_DIR}" >&2
  exit 1
fi

mkdir -p "${DEST_DIR}"

echo "[INFO] 크롬 자원을 엣지 확장 폴더로 복사합니다..."
echo "  원본: ${SOURCE_DIR}"
echo "  대상: ${DEST_DIR}"
echo ""

if command -v rsync >/dev/null 2>&1; then
  rsync -av --delete --exclude=".git" --exclude="node_modules" "${SOURCE_DIR}/" "${DEST_DIR}/"
else
  cp -R "${SOURCE_DIR}/." "${DEST_DIR}/"
fi

# 필수 파일 검증
MISSING=0
for FILE in manifest.json background.js content.js content.css options.html options.js shared/prompts.json shared/features.json shared/review-presentation.js; do
  if [ ! -f "${DEST_DIR}/${FILE}" ]; then
    echo "[ERROR] 필수 파일 누락: ${DEST_DIR}/${FILE}" >&2
    MISSING=$((MISSING + 1))
  fi
done

if [ "${MISSING}" -gt 0 ]; then
  echo ""
  echo "[ERROR] 총 ${MISSING}개 필수 파일이 누락되었습니다. 복사를 다시 시도하세요." >&2
  exit 1
fi

echo ""
echo "==================================================="
echo "[OK] Chrome/AIAng -> Edge/AIAng 복사 완료!"
echo "Edge 브라우저(edge://extensions)의 '압축해제된 확장 프로그램을 로드합니다'에서"
echo "${DEST_DIR} 폴더를 선택하세요."
echo "==================================================="
exit 0
