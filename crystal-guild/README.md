# 💎 크리스탈 길드 로또

길드원 전용 로또 사이트입니다. **Netlify** 한 곳에서 화면 + 서버(Functions) + 저장소(Blobs)까지 모두 돌아가서 별도 DB가 필요 없습니다.

## 기능

**길드원 (`/`)**
- 닉네임 + 비밀번호로 가입 / 로그인
- 보유 로또권과 지급·사용 내역 확인
- 1~45 중 6개 직접 고르기 또는 자동 — 로또권 1장 = 1줄, 한 번에 여러 줄 응모
- 추첨 결과 애니메이션, 내 번호 중 맞은 번호 강조, 등수 표시
- 지난 회차 당첨번호 / 당첨자 / 내 번호 결과

**운영자 (`/admin.html`)**
- 운영자 전용 로그인 (비밀번호는 Netlify 환경 변수)
- 로또권 지급·회수: 한 명(+1/+5/−1 빠른 버튼), 선택한 여러 명, 전체 길드원 / 사유 입력 가능
- 회차 열기 (1~5등 상품 설정) → 추첨하기 (당첨번호 6개 + 보너스 1개 무작위)
- 회차별 응모 현황과 당첨자 확인
- 길드원 비밀번호 초기화, 계정 삭제

**당첨 규칙** (한국 로또와 동일): 6개 1등 · 5개+보너스 2등 · 5개 3등 · 4개 4등 · 3개 5등

## Netlify 배포

1. Netlify → **Add new site → Import an existing project** → 이 GitHub 저장소 선택
2. 빌드 설정
   - **Base directory**: `crystal-guild`
   - Build command는 비워두기 (Publish / Functions 폴더는 `netlify.toml`에서 자동 인식)
3. **Site configuration → Environment variables** 에 추가

   | 이름 | 값 |
   |---|---|
   | `ADMIN_PASSWORD` | 운영자 비밀번호 (**필수**, 길게) |
   | `ADMIN_ID` | 운영자 아이디 (선택, 기본 `admin`) |
   | `SESSION_SECRET` | 아무 긴 랜덤 문자열 (선택, 없으면 자동 생성) |

4. 배포 후 `https://<사이트>.netlify.app/admin.html` 에서 운영자 로그인

환경 변수를 바꾼 뒤에는 **Deploys → Trigger deploy** 로 다시 배포해야 적용됩니다.

## 운영 순서 예시

1. 길드원들에게 사이트 주소를 알려주고 가입하게 함
2. 운영실에서 **1회 응모 시작** (상품 입력)
3. 출석·이벤트 보상으로 로또권 지급
4. 길드원들이 번호를 골라 응모
5. 정해진 시간에 **지금 추첨하기** → 결과가 모든 길드원 화면에 표시
6. **2회 응모 시작** (이전 상품 설정이 자동으로 채워짐)

## 개발

```bash
cd crystal-guild
npm install
npm test                    # API 전체 흐름 테스트 (로컬 Blobs 서버 사용)
node test/dev-server.mjs    # http://localhost:8888 , 운영자 비밀번호 admin1234
```

`netlify dev` 로도 실행할 수 있습니다.

## 구조

```
crystal-guild/
├─ netlify.toml
├─ netlify/functions/api.mjs   # /api/* — 로그인, 로또권, 응모, 추첨
├─ public/
│  ├─ index.html, app.js       # 길드원 화면
│  ├─ admin.html, admin.js     # 운영실
│  └─ common.js, style.css
└─ test/
```

데이터는 Netlify Blobs 저장소 `crystal-guild`에 저장되며, 비밀번호는 scrypt 해시로만 보관합니다.
