# ✦ 3D 스킬 팩 — MagicSpells + ItemsAdder (Java 1.20.4)

ItemsAdder 로 만든 **3D 모델**을 MagicSpells 가 `item_display` 엔티티로 소환하고,
`transformation` 보간 애니메이션(회전·낙하·확대)으로 움직이는 스킬 3종입니다.

| 스킬 | 발동 (비전 검 들고) | 연출 | 대미지 | 재사용 / 마나 |
|---|---|---|---|---|
| **초승달 참격** `yb_slash` | 우클릭 | 눈앞에 3D 초승달 검기가 -60°→+60° 로 휘둘러지며 커짐 | 전방 3.2칸 9 | 1.5초 / 10 |
| **아케인 서클** `yb_circle` | 웅크리고 우클릭 | 발밑에 3층 마법진이 펼쳐져 회전, 3번 맥동 후 폭발 | 4 + 4 + 10 (반경 3.5) + 구속·공중부양 | 8초 / 35 |
| **천공의 대검** `yb_heavenblade` | 웅크리고 좌클릭 | 7칸 앞에 경고 마법진 → 하늘에서 길이 7.5칸 대검이 떨어져 꽂힘 → 땅속으로 가라앉음 | 반경 4.5 18 + 공중부양 | 12초 / 60 |

명령어로도 사용 가능: `/c yb_slash`, `/c yb_circle`, `/c yb_heavenblade`
남은 모델 정리: `/c yb_cleanup` (관리자)

## 필요 플러그인
- Paper / Spigot **1.20.4**
- **ItemsAdder** 3.6 이상 (+ 의존성 LoneLibs / ProtocolLib)
- **MagicSpells** 4.0 beta (1.20.4 지원 빌드)

## 설치
1. 이 폴더의 `plugins/` 를 서버의 `plugins/` 에 그대로 덮어씁니다.
   - `plugins/ItemsAdder/contents/yaybae_skill/` → 아이템·3D 모델·텍스처
   - `plugins/MagicSpells/spells-yaybae3d.yml` → 스킬
2. 콘솔에서 `iazip` 실행 → 리소스팩 재생성 (접속자에게 자동 적용)
3. `ms reload` (또는 서버 재시작)
4. `/iagive <플레이어> yaybae_skill:arcane_blade` 로 무기 지급

## 구조
```
plugins/
├─ ItemsAdder/contents/yaybae_skill/
│  ├─ configs/items.yml              비전 검 + 연출용 모델 아이템 3개
│  └─ resourcepack/assets/yaybae_skill/
│     ├─ models/skill/*.json         3D 모델 (Blockbench 로 열어서 수정 가능)
│     └─ textures/{skill,item}/*.png
└─ MagicSpells/spells-yaybae3d.yml   MultiSpell(타이밍) + ExternalCommandSpell(연출)
```

## 작동 원리
- 연출용 모델은 `PAPER` + **CustomModelData 31001~31003** (`items.yml` 의 `model_id` 로 고정).
- MagicSpells 가 콘솔로 `summon item_display {item:{id:"paper",tag:{CustomModelData:...}}}` 를 실행하고,
  `MultiSpell` 의 `DELAY` 로 몇 틱 뒤 `data merge ... {interpolation_duration:N, transformation:{...}}`
  를 보내면 클라이언트가 그 사이를 부드럽게 보간합니다.
- 회전은 90°씩 끊어서 줍니다 (보간이 최단 경로로 돌기 때문에 180° 이상 한 번에 주면 반대로 돔).
- 태그에 시전자 이름(`%a`)을 붙여 여러 명이 동시에 써도 서로 섞이지 않습니다.

## 커스터마이징
- **대미지**: `damage @s 9 ...` 숫자 수정
- **PvP 허용**: 각 대미지 줄의 `type=!minecraft:player,` 를 지우고 `name=!%a,` 로 바꾸면 시전자를 뺀 플레이어도 맞습니다.
- **크기**: `scale:[3.4f,3.4f,3.4f]` 값 수정 (대검은 translation 도 같이 조정)
- **CustomModelData 충돌** 시: `items.yml` 의 `model_id` 와 스펠 파일의 `CustomModelData` 를 같이 바꾸세요.
- **참격 방향이 반대로 보이면**: `yb_slash_spawn` 의 `tp @s ~ ~ ~ ~ 0` 을 `~180 0` 으로 바꾸세요.
- 텍스처 다시 생성: 저장소 루트에서 `python3 tools/gen_3dskill_textures.py`

## 문제 해결
- 모델이 보라/검정 체크무늬 → `iazip` 안 함 or 리소스팩 미적용
- 아무 것도 안 보임 → `/iaget yaybae_skill:heaven_blade_model` 로 받은 종이를 F3+H 로 보고 CustomModelData 가 31001 인지 확인
- `ms cast as` 가 안 됨 → MagicSpells 버전에 따라 ItemsAdder 명령을 `as_console: false` + `c yb_slash` 로 바꿔도 됩니다.
