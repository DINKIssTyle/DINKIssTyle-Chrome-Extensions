# Local AI Assistant (LLM)

A Chrome extension that leverages local LLM servers for AI-powered text processing, image analysis, and text enhancement.

## Features

- **Text Processing**: Select text and send it to your local LLM with a custom prompt
- **Vision Mode**: Analyze images using vision-capable LLM models
- **Text Enhancement**: Improve text directly in input fields with AI assistance
- **Streaming Support**: Real-time response streaming for faster feedback
- **Multi-language**: Supports English and Korean based on browser language

## Requirements

- Local LLM server (e.g., LM Studio, Ollama) running with OpenAI-compatible API
- For Vision Mode: A vision-capable model (e.g., Qwen3-VL, LLaVA)

## Installation

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the `Local-AI-Assistant` folder

## Usage

### Text Processing
1. Select text on any webpage
2. Right-click → "Process with Local AI Assistant (LLM)"
3. Chat window opens with AI response

### Image Analysis (Vision Mode)
1. Enable "Vision Mode" in extension settings
2. Right-click on any image → "Analyze Image with Vision AI"
3. Chat window opens with image analysis

### Text Enhancement
1. Enable "Text Enhancement" in extension settings
2. Type text in any input field
3. Right-click → "Enhance Text with AI"
4. Text is automatically improved in place

## Configuration

Click the extension icon to configure:
- **Server Address**: Your LLM server address (default: `localhost:1234`)
- **Model Key**: Specify model name if multiple models are loaded
- **Max Tokens**: Maximum response length
- **Temperature**: Response creativity (0-2)
- **System Role**: Custom system prompt
- **Request Prefix**: Prefix added to selected text

---

# 로컬 AI 어시스턴트 (LLM)

로컬 LLM 서버를 활용하여 AI 기반 텍스트 처리, 이미지 분석, 텍스트 향상을 제공하는 Chrome 확장 프로그램입니다.

## 기능

- **텍스트 처리**: 텍스트를 선택하고 사용자 정의 프롬프트와 함께 로컬 LLM에 전송
- **비전 모드**: 비전 지원 LLM 모델을 사용하여 이미지 분석
- **텍스트 향상**: AI를 사용하여 입력 필드의 텍스트를 직접 개선
- **스트리밍 지원**: 빠른 피드백을 위한 실시간 응답 스트리밍
- **다국어**: 브라우저 언어에 따라 영어와 한국어 지원

## 요구 사항

- OpenAI 호환 API가 있는 로컬 LLM 서버 (예: LM Studio, Ollama)
- 비전 모드의 경우: 비전 지원 모델 (예: Qwen3-VL, LLaVA)

## 설치

1. 이 저장소를 클론하거나 다운로드
2. Chrome에서 `chrome://extensions/` 열기
3. "개발자 모드" 활성화
4. "압축 해제된 확장 프로그램 로드"를 클릭하고 `Local-AI-Assistant` 폴더 선택

## 사용법

### 텍스트 처리
1. 웹페이지에서 텍스트 선택
2. 우클릭 → "로컬 AI 어시스턴트로 처리"
3. AI 응답이 포함된 채팅 창 열림

### 이미지 분석 (비전 모드)
1. 확장 프로그램 설정에서 "비전 모드" 활성화
2. 이미지에서 우클릭 → "비전 AI로 이미지 분석"
3. 이미지 분석이 포함된 채팅 창 열림

### 텍스트 향상
1. 확장 프로그램 설정에서 "텍스트 향상" 활성화
2. 입력 필드에 텍스트 입력
3. 우클릭 → "AI로 텍스트 향상"
4. 텍스트가 자동으로 개선됨

## 설정

확장 프로그램 아이콘을 클릭하여 설정:
- **서버 주소**: LLM 서버 주소 (기본값: `localhost:1234`)
- **모델 키**: 여러 모델이 로드된 경우 모델 이름 지정
- **최대 토큰**: 최대 응답 길이
- **Temperature**: 응답 창의성 (0-2)
- **시스템 역할**: 사용자 정의 시스템 프롬프트
- **요청 접두사**: 선택한 텍스트 앞에 추가되는 접두사

---

## License

Copyright (C) 2026 DINKI'ssTyle. All rights reserved.
