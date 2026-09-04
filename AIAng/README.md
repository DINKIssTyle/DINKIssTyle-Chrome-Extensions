# AIAng by DKST

다모앙(damoang.net)에서만 동작하는 Chrome / Microsoft Edge 확장 프로그램과 Apple(iOS/iPadOS & macOS Safari Web Extension, Mac Catalyst 호스트 설정 앱)을 함께 관리합니다.

- 앱 이름: AIAng by DKST
- App Store Connect SKU / 앱 Bundle ID: com.dinkisstyle.aiang
- 확장 Bundle ID: com.dinkisstyle.aiang.Extension
- 현재 버전: 0.2.0 (1)
- 최소 OS: iOS 17 / macOS 14 (Mac Catalyst 17)
- Apple Intelligence 직접 연동: iOS 26 / macOS 26 이상에서 사용 가능
- 온디바이스 AI 지원: Chrome Gemini Nano, Microsoft Edge On-Device AI (Aion-1.0-Instruct / Phi-4-mini / Summarizer)

## 프로젝트 열기

Chrome에서는 `Chrome/AIAng` 폴더를 `chrome://extensions`의 **압축해제된 확장 프로그램을 로드합니다**에서 선택합니다.

Microsoft Edge에서는 `Edge/AIAng` 폴더를 `edge://extensions`의 **압축해제된 확장 프로그램을 로드합니다**에서 선택합니다. 개발은 항상 Chrome에서 먼저 진행하며, 수정 후 아래 복사 스크립트를 통해 Edge로 덮어씌웁니다.

- **Windows**: `Edge\copy-from-chrome.bat`
- **macOS / Linux**: `./Edge/copy-from-chrome.sh`

iOS/AIAng/AIAng.xcodeproj를 Xcode에서 엽니다. 앱과 확장 타깃의 Signing & Capabilities에서 같은 개발 팀을 선택하고 아래 App Group 및 Keychain Sharing 항목이 개발자 계정에 등록되어 있는지 확인합니다.

- App Group: group.com.dinkisstyle.aiang
- Keychain Group: $(AppIdentifierPrefix)com.dinkisstyle.aiang.shared

실기기에서 앱을 한 번 실행해 AI 설정을 저장한 다음, 설정 앱의 Safari 확장 프로그램 화면에서 **AIAng by DKST**를 켜고 damoang.net 접근을 항상 허용합니다.

AI 제공자, API 주소, 모델, 개인화 설정은 모두 UIKit 호스트 앱에서 관리합니다. Safari 확장에는 웹 옵션 페이지를 포함하지 않으며, 다모앙의 톱니 버튼은 `aiang-dkst://settings` 딥링크로 호스트 앱을 엽니다.

게시물 보기 화면에서는 게시물 요약, 댓글 반응 요약과 용어 사전을 실행할 수 있습니다. 댓글 입력기에서는 게시물 제목·본문을 바탕으로 `긍정•동의•응원`, `부정•부동의`, `화가나요`, `농담` 분위기의 댓글 초안을 생성할 수 있습니다. 결과의 제목, 목록, 인용문, 표, 코드 및 안전한 링크는 Markdown 형식으로 표시되며, iPhone 화면의 모든 결과 모달은 Safari의 웹 콘텐츠 영역을 가득 채웁니다.

## 공통 웹 확장 코드

`Chrome/AIAng/content.js`, `content.css`, `shared/prompts.json`, `shared/features.json`, `shared/review-presentation.js`가 웹 UI·AI 프롬프트·기능 플래그·교정 표시 정책의 기준 원본입니다. iOS의 `Copy Shared Web Resources` 빌드 단계가 이 파일들을 Safari 확장 번들에 직접 복사하므로 Resources 디렉터리에 중복 사본이나 심볼릭 링크를 두지 않습니다. 공통 프롬프트 문구는 `shared/prompts.json`, 댓글 생성 활성화 여부는 `shared/features.json`, 브라우저·기기·기능별 인라인/모달 선택은 `shared/review-presentation.js` 한 곳에서 수정합니다.

공통 스크립트는 브라우저와 물리적 기기 유형을 런타임에 판별합니다. 현재 데스크톱 Chrome과 Mac Safari의 맞춤법 검사만 인라인으로 표시하고, 태블릿·모바일 및 그 밖의 기능은 모달을 사용합니다. 정의되지 않은 조합은 데스크톱·태블릿·모바일 기본값을 따릅니다. 설정 화면은 Chrome 옵션 페이지와 Safari의 `aiang-dkst://settings` 호스트 앱으로 나뉘며, JSON 응답 형식과 Apple Intelligence guided generation 같은 호출 규약, manifest, 백그라운드 처리만 플랫폼별로 유지합니다.

## 세션과 개인정보

웹페이지를 앱 안에 다시 띄우지 않습니다. 확장은 실제 Safari의 다모앙 탭에 삽입되므로 로그인 쿠키, 자동 로그인, 로그아웃 상태는 Safari가 관리하고 기존 Safari 세션이 그대로 유지됩니다. 개인 정보 보호 브라우징에서는 별도 세션을 사용하며, 사용자가 확장의 개인 정보 보호 브라우징 접근도 허용해야 합니다.

콘텐츠 스크립트는 damoang.net과 www.damoang.net에서만 실행됩니다. API 키는 공유 Keychain에 저장하고 다모앙 콘텐츠 스크립트에는 반환하지 않습니다. 교정 대상 텍스트는 사용자가 선택한 경우에만 Apple 온디바이스 모델 또는 사용자가 설정한 LLM API로 전달됩니다.

## AI 제공자

- **자동**: 지원 기기에서는 Apple Intelligence를 우선 사용하고, 사용할 수 없거나 입력이 온디바이스 처리 한도를 넘으면 설정된 LLM API를 사용합니다.
- **Apple Intelligence**: 지원되는 iOS, 기기, 언어 모델이 준비된 경우에만 온디바이스로 처리합니다.
- **LLM API**: OpenAI 호환 /v1/chat/completions, /v1/models API를 사용합니다. HTTP는 localhost, .local, 사설 IPv4 및 Tailscale 주소에 허용하며, 사용자가 위험 경고를 확인하고 명시적으로 켠 경우 원격 HTTP 주소도 사용할 수 있습니다.

## 명령행 검증

댓글 생성 기능은 `Chrome/AIAng/shared/features.json`의 `commentGeneration` 값 하나로 모든 브라우저를 함께 제어합니다. `false`이면 모든 확장의 댓글 생성 버튼과 요청 처리가 비활성화됩니다.

    node --test Tests/EdgeResourceTests.cjs
    node --test Tests/SafariResourceTests.cjs
    node --test Chrome/AIAng/tests/background-core.test.cjs
    node --check Chrome/AIAng/background.js
    node --check Chrome/AIAng/content.js
    node --check Chrome/AIAng/options.js
    node --check Edge/AIAng/background.js
    node --check Edge/AIAng/content.js
    node --check Edge/AIAng/options.js
    # iOS 빌드 검증
    xcodebuild -project iOS/AIAng/AIAng.xcodeproj -scheme AIAng \
      -configuration Debug -sdk iphoneos -destination 'generic/platform=iOS' \
      -derivedDataPath /private/tmp/aiang-derived CODE_SIGNING_ALLOWED=NO build

    # macOS (Mac Catalyst) 빌드 검증
    xcodebuild -project iOS/AIAng/AIAng.xcodeproj -scheme AIAng \
      -configuration Debug -destination 'platform=macOS,variant=Mac Catalyst' \
      -derivedDataPath /private/tmp/aiang-derived CODE_SIGNING_ALLOWED=NO build

상세 구현 및 출시 계획은 [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)를 참고하세요.
