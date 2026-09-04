# AIAng for Microsoft Edge

Microsoft Edge 브라우저에서 다모앙(damoang.net)의 글과 댓글을 교정하고 요약하는 로컬·온디바이스 AI 확장 프로그램입니다.

- **확장 프로그램 폴더**: `Edge/AIAng`
- **지원 브라우저**: Microsoft Edge (데스크톱)
- **온디바이스 AI 모델**: Microsoft Aion-1.0-Instruct (프리뷰), Phi-4-mini, Edge 내장 Summarizer

---

## 1. Edge 확장 프로그램 로드 방법

1. Microsoft Edge 주소창에 `edge://extensions` 를 입력하여 확장 관리 페이지로 이동합니다.
2. 좌측 하단 또는 상단의 **개발자 모드 (Developer mode)** 토글 스위치를 켭니다.
3. **[압축해제된 확장 프로그램을 로드합니다]** (Load unpacked) 버튼을 클릭합니다.
4. 이 저장소의 `Edge/AIAng` 폴더를 선택합니다.
5. 다모앙(damoang.net) 웹사이트를 열고 AIAng 기능을 사용합니다.

---

## 2. Chrome 개발 후 Edge로 동기화 (복사 스크립트)

AIAng는 **Chrome(`Chrome/AIAng`)에서 먼저 개발**한 후 Edge로 덮어씌우는 단일 소스 워크플로를 따릅니다. 코드를 수정한 후 아래 스크립트를 실행하면 Chrome의 최신 파일들이 `Edge/AIAng`로 자동 동기화됩니다.

### Windows
CMD 또는 PowerShell에서 실행:
```cmd
Edge\copy-from-chrome.bat
```

### macOS / Linux
터미널에서 실행:
```bash
./Edge/copy-from-chrome.sh
```

> **참고**: `background.js`와 `options.js`는 브라우저를 런타임에 자동 감지하므로, Chrome 코드를 그대로 복사해도 Edge에서는 "Microsoft Edge 내장 AI (Aion / Phi-4)" 및 Edge 플래그 설정 가이드가 자동으로 적용됩니다.

---

## 3. Microsoft Edge 온디바이스 AI 활성화 (선택 사항)

Edge의 내장 소형 언어 모델(Aion-1.0-Instruct / Phi-4-mini)을 온디바이스로 사용하려면 Edge Canary 또는 Dev 채널에서 아래 플래그를 설정하세요:

1. 주소창에 `edge://flags` 입력 (또는 `edge://flags/#edge-llm-prompt-api-for-phi-mini` 로 바로 이동)
2. **Prompt API for Phi-4-mini** (`#edge-llm-prompt-api-for-phi-mini`) -> **Enabled** 설정
3. **Writing Assistance APIs** (또는 `#edge-llm-summarization-api-for-phi-mini`) -> **Enabled** 설정
4. Edge 브라우저를 다시 시작합니다.
5. AIAng 설정 페이지에서 AI 제공자를 **[Microsoft Edge 내장 AI · Aion / Phi-4]**로 선택합니다.

*참고: 플래그 이름은 OS/기기와 무관하게 동일하며, Edge Canary 및 Dev 채널(138+ 이상)에서 제공됩니다. 외부 LLM 서버(LM Studio, Ollama, OpenAI 호환 API)를 사용하는 경우 위 플래그 설정 없이 즉시 사용할 수 있습니다.*
