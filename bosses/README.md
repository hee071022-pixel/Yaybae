# 마법진 보스 5종 (Blockbench)

`*.bbmodel` 파일을 [Blockbench](https://www.blockbench.net/)에서 열면 모델·텍스처·애니메이션이 모두 들어 있습니다.
형식: Bedrock 엔티티 (박스 UV + 마법진 판은 128px 면 UV). 애니메이션 이름은 `animation.mdv.<보스>.<동작>`.

| 파일 | 보스 | 애니메이션 |
|---|---|---|
| `circle_warden.bbmodel` | 마법진 수호자 — 등 뒤 마법진 후광, 팔의 방패 마법진 | idle, move, attack, cast_circle, death |
| `rune_golem.bbmodel` | 룬 골렘 — 가슴·손바닥 마법진, 떠도는 룬석 | idle, walk, smash, rune_burst, death |
| `abyss_archmage.bbmodel` | 심연의 대마법사 — 발밑 이중 마법진, 지팡이, 공전하는 마법서 | idle, move, cast, summon, death |
| `astral_eye.bbmodel` | 별의 눈 — 세 축으로 도는 마법진 고리, 수정 파편 | idle, stare, beam, death |
| `primordial_sovereign.bbmodel` | 태초의 군주 — 신초의 검, 빛의 날개, 거대 마법진 | idle, walk, slash, primordial_circle, death |

`preview/` 에 미리보기와 텍스처 PNG가 있습니다. 다시 만들려면 `python3 tools/bosses.py`.
마법진 판의 등장/소멸은 스케일 애니메이션으로 처리하며(대기 중에는 0), 발광 부위는 불투명 텍스처라 게임에 넣을 때 `entity_emissive_alpha` 같은 재질을 쓰면 더 빛나 보입니다.
