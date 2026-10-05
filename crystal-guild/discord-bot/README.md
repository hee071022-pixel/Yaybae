# 크리스탈 길드 디스코드 봇 (파이썬)

PC(또는 서버)에서 켜두는 봇입니다. `/사이트`를 치면 크리스탈 길드 사이트 링크를 보여줍니다(사이트와 따로 작동). 명령어 등록도 봇이 켜질 때 알아서 합니다(내 인터넷으로 등록해서 오류 429 걱정 없음). 봇이 켜져 있는 동안 디스코드에 **온라인**으로 보입니다.

## 준비 (한 번만)

1. [파이썬](https://www.python.org/downloads/) 설치 — 설치 화면에서 **Add python.exe to PATH** 꼭 체크
2. 디스코드 개발자 포털 → 앱 → **General Information** → **Interactions Endpoint URL** 칸을 **비우고 Save**
   (이 칸에 주소가 있으면 디스코드가 명령어를 봇이 아니라 사이트로 보냅니다)

## 호스팅 서버(Pterodactyl 패널)에서 실행

1. **Files**에 `app.py`, `requirements.txt`, `config.example.json` 올리기 (run.bat / run.sh는 필요 없음)
2. `config.example.json`을 **config.json**으로 이름 바꾸고 `token` 칸에 봇 토큰 넣기
3. **Startup** 탭: App py file = `app.py`, Requirements file = `requirements.txt`
4. 서버 시작 → 콘솔에 `봇 켜짐`이 뜨면 성공

## 내 PC에서 실행

- 윈도우: `run.bat` 더블클릭
- 맥/리눅스: `./run.sh`

처음 실행하면 **봇 토큰**과 **사이트 주소**(엔터 = 크리스탈 길드 사이트)를 물어보고 `config.json`에 저장합니다. `봇 켜짐` 이 뜨면 디스코드에서 `/사이트`를 쳐보세요. 창을 닫으면 봇이 꺼집니다.

토큰을 바꿨으면 `config.json`을 지우고 다시 실행하세요. `config.json`에는 토큰이 들어 있으니 남에게 주지 마세요.

환경 변수 `DISCORD_BOT_TOKEN`, `SITE_URL`, `DISCORD_GUILD_ID`로도 설정할 수 있습니다(24시간 서버에 올릴 때).
