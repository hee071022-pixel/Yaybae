# OrCAD Capture CIS 17.4 / PCB Editor용 파일

> ⚠️ Capture가 없는 환경에서 만든 파일이라 실제 import를 테스트하지 못했습니다.

| 파일 | 용도 |
|---|---|
| `PRACTICE3.edf` | 회로도 (EDIF 2 0 0) → Capture로 가져오기 |
| `PRACTICE3_telesis.net` | 넷리스트 (Telesis) → PCB Editor로 바로 가져오기 |
| `make_orcad.py` | 위 두 파일 생성 스크립트 (값·좌표 수정 후 `python make_orcad.py`) |

## 1) Capture로 회로도 가져오기
1. Capture CIS 17.4 실행 → **File → Import Design**
2. **EDIF** 탭 → Open: `PRACTICE3.edf`, Save As: `PRACTICE3.DSN` → OK
3. File → Open → Design → `PRACTICE3.DSN`

- 부품은 원본 도면 위치와 비슷하게 배치되고, 각 핀에 짧은 선(stub)이 붙어 있습니다.
  연결은 EDIF 넷 정보로 들어가며, 화면에서는 **W**키로 stub끼리 이어 주면 원본과 같은 모양이 됩니다.
- 전원은 넷 이름 `+V`, `-V`, `GND`로 들어갑니다. 과제 기호에 맞추려면 Place Power(F) `VCC_ARROW`(+V), `VCC_CIRCLE`(-V), Place Ground(G) `GND`로 바꾸세요.
- 가져온 뒤 **Tools → Design Rules Check** 실행.

## 2) PCB Editor로 넷리스트 바로 가져오기 (Capture 건너뛰기)
1. PCB Editor 17.4 → 새 보드 생성
2. **File → Import → Logic/Netlist → Other** 탭 → `PRACTICE3_telesis.net` 선택
3. 풋프린트 이름(`RES400`, `CAP200`, `CAPPOL200`, `DIODE400`, `POT3`, `TO92`, `DIP8`, `HDR2`, `HDR3`)이
   사용하는 라이브러리 이름과 다르면 `.net` 파일 `$PACKAGES` 부분의 첫 번째 '...'를 실제 이름으로 바꾸세요.

## 핀 번호 규칙
- 다이오드/제너: 1 = K(캐소드), 2 = A
- 전해콘덴서: 1 = +, 2 = −
- Q1 (C1815): 1 = E, 2 = C, 3 = B / Q2 (K30): 1 = S, 2 = G, 3 = D
- LF356: 2 = −, 3 = +, 4 = −V, 6 = OUT, 7 = +V, 1·5·8 = NC
- J1: 1 = +12V, 2 = GND, 3 = −12V

## 추정한 부분 (원본 사진에서 잘림)
- U4 출력 → R6·R4 공통점(VREF). R1~R15가 전부 다른 곳에 쓰여서 U4에는 귀환저항이 없는 것으로 봤습니다(비교기 동작).
- J2: 1 = OUT_1, 2 = GND / J3: 연결 미확인 (빈 채로 둠)
