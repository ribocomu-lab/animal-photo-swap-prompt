# 동물 수경 셀카 만들기 (Goggle Selfie Web App)

사용자가 **동물 사진 1장만 업로드하면**, 서버에 고정된 레퍼런스 3장(`duck.jpeg`, `hippo.jpeg`, `pig.jpeg`)과 고정 프롬프트(`poc/prompt.txt`)를 사용해 **"검은 수모와 연두색 수경을 쓴 동물 셀카"**를 생성하는 모바일 우선 Next.js 웹앱입니다.

---

## 1. 실행 방법

### 패키지 설치
```bash
npm install
```

### 개발 서버 실행 (기본값: `mock` 테스트 모드)
API 결제가 활성화되기 전에는 기본값인 `mock` 모드로 실행되어 Gemini API를 호출하지 않고 화면 흐름을 테스트할 수 있습니다.
```bash
npm run dev
```
브라우저에서 `http://localhost:3000`으로 접속합니다.

### 프로덕션 빌드 및 실행
```bash
npm run build
npm run start
```

### 린트 및 테스트 실행
```bash
npm run lint
npm test
```

---

## 2. 환경 변수

`.env.example`을 참고하여 `.env.local` 파일을 구성합니다. (`.env.local`은 Git에 커밋하지 않습니다.)

| 환경 변수 | 기본값 | 설명 |
|---|---|---|
| `GENERATION_MODE` | `mock` | 실행 모드 (`mock` 또는 `live`).<br>- `mock`: Gemini를 호출하지 않고 2초 뒤 샘플 이미지(`poc/references/pig.jpeg`)를 반환하며, 화면에 **"테스트 모드: 실제 생성 결과가 아닙니다"**를 항상 표시합니다.<br>- `live`: 실제 Gemini API(`gemini-nano-banana-2.1`)를 호출합니다. `GEMINI_API_KEY`가 없으면 시작 시 즉시 오류를 내며 `mock`으로 자동 전환하지 않습니다. |
| `GEMINI_API_KEY` | (없음) | `GENERATION_MODE=live`일 때 필수인 Google Gemini API 키입니다. |
| `MAX_DAILY_GENERATIONS` | `50` | 하루 전체 최대 생성 횟수 한도입니다. 클라이언트별 한도는 하루 3회로 고정되어 있습니다. |

---

## 3. 아키텍처 및 보안/개인정보 원칙

- **고정 입력 보호**: 레퍼런스 이미지 3장(`poc/references/duck.jpeg`, `hippo.jpeg`, `pig.jpeg`)과 프롬프트(`poc/prompt.txt`)는 서버 파일 시스템에서만 읽으며, `public/` 경로로 복사하거나 클라이언트 번들에 포함하지 않습니다.
- **파라미터 고정**: `POST /api/generate`는 `subject` 이미지 1장과 동의 여부(`isAdult`, `geminiConsent`)만 받으며, 프롬프트·레퍼런스·모델·해상도 변경 시도는 거부합니다.
- **실제 이미지 검사**: 파일 확장자나 클라이언트가 보낸 MIME 타입이 아니라 파일 바이너리의 매직 바이트(JPEG, PNG, WebP)와 10MB 이하 여부를 검사합니다.
- **사진 미저장 및 로그 보호**: 업로드된 사용자 사진과 생성 결과 이미지는 디스크나 데이터베이스에 저장하지 않고 요청 처리 직후 메모리에서 해제합니다. 이미지 데이터, base64 문자열, API 키는 서버 로그에 남기지 않습니다.
- **메모리 기반 카운터 주의사항**: 현재 클라이언트별 일일 3회 제한 및 전체 일일 `MAX_DAILY_GENERATIONS`회 제한에 사용된 메모리 기반 카운터(`src/lib/rate-limit.ts`)는 **로컬 개발에만 사용**합니다. 서버 재시작 시 초기화되고 다중 인스턴스(서버리스 등) 환경에서 공유되지 않으므로 **공개 배포 전에 반드시 Redis/KV 등 영구 저장소로 교체**해야 합니다.

---

## 4. 공개 배포 전 할 일 (체크리스트)

1. Google API 결제 문제를 해결하고 `live` 모드에서 품질을 확인한다.
2. 레퍼런스 3장의 사용 권리를 확인하거나 권리가 확보된 이미지로 교체한다.
3. 사용 횟수 제한(메모리 기반 카운터)을 영구 저장소(Redis, Upstash, Cloud KV 등)로 옮긴다.
4. 개인정보 처리 안내와 이용약관을 추가한다.
5. 만 18세 미만 대상 채널에서 홍보하지 않도록 운영 기준을 정한다.
