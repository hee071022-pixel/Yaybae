-- 오션 레거시 게임 설정 (서버/클라이언트 공용)
-- 숫자를 바꿔서 밸런스를 조절할 수 있습니다.

local C = Color3.fromRGB

local Config = {}

---------------------------------------------------------------------------
-- 성장
---------------------------------------------------------------------------
Config.MaxLevel = 300
Config.StatPointsPerLevel = 3
Config.StatScale = 0.04 -- 스탯 1포인트당 데미지 +4%
Config.StartBeli = 300
Config.RespawnTime = 4
Config.WalkSpeed = 22
Config.JumpPower = 55
Config.M1Cooldown = 0.3

Config.Stats = { "Melee", "Defense", "Sword", "Fruit" }
Config.StatNames = {
	Melee = "근접",
	Defense = "방어",
	Sword = "검술",
	Fruit = "열매",
}

function Config.XPForLevel(level)
	return math.floor(100 + (level ^ 1.6) * 22)
end

function Config.MaxHealth(level, defense)
	return 100 + (level - 1) * 8 + defense * 12
end

---------------------------------------------------------------------------
-- 섬 (x축으로 바다를 따라 배치)
---------------------------------------------------------------------------
Config.GroundY = 8
Config.Islands = {
	{ Id = "Starter", Name = "시작의 섬", Center = Vector3.new(0, 0, 0), Radius = 150, Level = 1, Theme = "Starter" },
	{ Id = "Jungle", Name = "정글 섬", Center = Vector3.new(650, 0, -150), Radius = 170, Level = 10, Theme = "Jungle" },
	{ Id = "Desert", Name = "사막 섬", Center = Vector3.new(1300, 0, 100), Radius = 180, Level = 30, Theme = "Desert" },
	{ Id = "Snow", Name = "설원 섬", Center = Vector3.new(1950, 0, -120), Radius = 180, Level = 60, Theme = "Snow" },
	{ Id = "Marine", Name = "해군 요새", Center = Vector3.new(2650, 0, 80), Radius = 190, Level = 100, Theme = "Marine" },
}
Config.IslandById = {}
for i, island in Config.Islands do
	island.Order = i
	Config.IslandById[island.Id] = island
end

---------------------------------------------------------------------------
-- 적 (Health/Damage/XP/Beli는 레벨로 자동 계산, 직접 적으면 덮어씀)
---------------------------------------------------------------------------
Config.Enemies = {
	-- 시작의 섬
	Bandit = { Name = "산적", Level = 3, Island = "Starter", Count = 6, Skin = C(234, 184, 146), Shirt = C(130, 85, 50), Pants = C(70, 55, 40) },
	Pirate = { Name = "해적 졸개", Level = 7, Island = "Starter", Count = 6, Skin = C(204, 142, 105), Shirt = C(200, 40, 40), Pants = C(40, 40, 70) },
	BanditBoss = {
		Name = "산적 두목",
		Level = 12,
		Island = "Starter",
		Count = 1,
		Boss = true,
		Scale = 1.6,
		Skin = C(204, 142, 105),
		Shirt = C(90, 50, 25),
		Pants = C(30, 30, 30),
	},
	-- 정글 섬
	Monkey = {
		Name = "원숭이",
		Level = 14,
		Island = "Jungle",
		Count = 6,
		Scale = 0.8,
		Skin = C(150, 100, 60),
		Shirt = C(110, 70, 40),
		Pants = C(110, 70, 40),
	},
	Gorilla = { Name = "고릴라", Level = 22, Island = "Jungle", Count = 6, Scale = 1.3, Skin = C(60, 60, 60), Shirt = C(40, 40, 40), Pants = C(40, 40, 40) },
	GorillaKing = {
		Name = "고릴라 킹",
		Level = 32,
		Island = "Jungle",
		Count = 1,
		Boss = true,
		Scale = 2.1,
		Skin = C(50, 50, 50),
		Shirt = C(25, 25, 25),
		Pants = C(120, 20, 20),
	},
	-- 사막 섬
	DesertThief = {
		Name = "사막 도적",
		Level = 36,
		Island = "Desert",
		Count = 6,
		Skin = C(204, 142, 105),
		Shirt = C(230, 210, 160),
		Pants = C(150, 110, 70),
	},
	DesertOfficer = {
		Name = "사막 장교",
		Level = 48,
		Island = "Desert",
		Count = 6,
		Skin = C(234, 184, 146),
		Shirt = C(170, 130, 60),
		Pants = C(80, 60, 30),
	},
	SandLord = {
		Name = "모래 군주",
		Level = 60,
		Island = "Desert",
		Count = 1,
		Boss = true,
		Scale = 1.9,
		Skin = C(220, 190, 120),
		Shirt = C(240, 200, 60),
		Pants = C(120, 90, 40),
	},
	-- 설원 섬
	SnowBandit = { Name = "설원 산적", Level = 65, Island = "Snow", Count = 6, Skin = C(234, 184, 146), Shirt = C(90, 120, 170), Pants = C(230, 230, 240) },
	Yeti = { Name = "예티", Level = 80, Island = "Snow", Count = 6, Scale = 1.6, Skin = C(240, 245, 255), Shirt = C(230, 235, 250), Pants = C(230, 235, 250) },
	IceAdmiral = {
		Name = "얼음 대장",
		Level = 100,
		Island = "Snow",
		Count = 1,
		Boss = true,
		Scale = 2,
		Skin = C(234, 184, 146),
		Shirt = C(240, 240, 255),
		Pants = C(60, 90, 160),
	},
	-- 해군 요새
	Marine = { Name = "해군", Level = 105, Island = "Marine", Count = 7, Skin = C(234, 184, 146), Shirt = C(245, 245, 245), Pants = C(30, 60, 140) },
	MarineCaptain = {
		Name = "해군 대령",
		Level = 125,
		Island = "Marine",
		Count = 6,
		Scale = 1.15,
		Skin = C(204, 142, 105),
		Shirt = C(250, 250, 250),
		Pants = C(20, 30, 80),
	},
	ViceAdmiral = {
		Name = "해군 중장",
		Level = 150,
		Island = "Marine",
		Count = 1,
		Boss = true,
		Scale = 2.2,
		Skin = C(234, 184, 146),
		Shirt = C(255, 255, 255),
		Pants = C(15, 20, 60),
	},
}

for id, e in Config.Enemies do
	local lv = e.Level
	local boss = e.Boss == true
	e.Id = id
	e.Health = e.Health or math.floor((50 + lv * 20) * (boss and 7 or 1))
	e.Damage = e.Damage or math.floor((6 + lv * 1.6) * (boss and 1.8 or 1))
	e.XP = e.XP or math.floor((15 + (lv ^ 1.45) * 10) * (boss and 6 or 1))
	e.Beli = e.Beli or math.floor((8 + lv * 3) * (boss and 10 or 1))
	e.WalkSpeed = e.WalkSpeed or (boss and 18 or 16)
	e.AttackCooldown = e.AttackCooldown or (boss and 1.1 or 1.5)
	e.AttackRange = e.AttackRange or (5 * (e.Scale or 1))
	e.AggroRange = e.AggroRange or (boss and 60 or 45)
	e.LeashRange = e.LeashRange or 90
	e.RespawnTime = e.RespawnTime or (boss and 45 or 8)
end

---------------------------------------------------------------------------
-- 퀘스트 (적 하나당 하나씩 자동 생성)
---------------------------------------------------------------------------
Config.Quests = {}
for id, e in Config.Enemies do
	local amount = e.Boss and 1 or 6
	Config.Quests[id] = {
		Id = id,
		Target = id,
		Island = e.Island,
		Level = math.max(1, e.Level - (e.Boss and 0 or 2)),
		Amount = amount,
		XP = math.floor(e.XP * amount * (e.Boss and 2 or 1.5)),
		Beli = math.floor((100 + (e.Level ^ 1.3) * 25) * (e.Boss and 3 or 1)),
	}
end

---------------------------------------------------------------------------
-- 검
---------------------------------------------------------------------------
Config.Swords = {
	Katana = { Name = "카타나", Price = 800, Damage = 1.0, Color = C(200, 200, 210), Length = 4, Order = 1 },
	Cutlass = { Name = "커틀러스", Price = 5000, Damage = 1.25, Color = C(220, 190, 120), Length = 4, Order = 2 },
	Saber = { Name = "사브르", Price = 20000, Damage = 1.6, Color = C(140, 200, 255), Length = 4.5, Order = 3 },
	DragonBlade = { Name = "용의 검", Price = 80000, Damage = 2.2, Color = C(255, 90, 40), Length = 5, Order = 4, Neon = true },
	BlackBlade = { Name = "흑도", Price = 250000, Damage = 3.0, Color = C(30, 20, 40), Length = 6, Order = 5, Neon = true },
}

---------------------------------------------------------------------------
-- 스킬 정의
-- Type: Melee(앞 범위) / Barrage(연타) / AOE(범위 폭발) / Projectile(투사체)
--       Dash(돌진) / Beam(광선) / Rain(여러 번 낙하)
-- 옵션: Stun(초), Burn={Damage,Ticks}, Knockback, Pull, AtMouse, Pierce
---------------------------------------------------------------------------
Config.Skills = {
	Combat = {
		Color = C(255, 240, 200),
		M1 = { Damage = 12, Range = 6, Radius = 4.5 },
		Z = { Name = "강타", Type = "Melee", Damage = 40, Range = 8, Radius = 6, Cooldown = 4, Knockback = 70, Level = 1 },
		X = { Name = "연속 주먹", Type = "Barrage", Damage = 10, Hits = 8, Interval = 0.1, Range = 7, Radius = 6, Cooldown = 9, Level = 10 },
		C = { Name = "파괴의 일격", Type = "AOE", Damage = 120, Radius = 14, Cooldown = 16, Knockback = 110, Level = 30 },
	},
	Sword = {
		Color = C(220, 230, 255),
		M1 = { Damage = 16, Range = 8, Radius = 5 },
		Z = { Name = "일섬", Type = "Dash", Damage = 45, Range = 30, Radius = 5, Cooldown = 5, Level = 1 },
		X = { Name = "회전 베기", Type = "Barrage", Damage = 14, Hits = 5, Interval = 0.12, Range = 0, Radius = 12, Cooldown = 10, Level = 20 },
		C = { Name = "참격파", Type = "Projectile", Damage = 150, Speed = 120, Range = 120, Size = 4, Radius = 6, Cooldown = 15, Level = 50, Pierce = true },
	},
}

---------------------------------------------------------------------------
-- 악마의 열매 (랜덤 뽑기)
---------------------------------------------------------------------------
Config.FruitPrice = 2500
Config.RarityWeights = { Common = 50, Rare = 30, Legendary = 15, Mythical = 5 }
Config.RarityNames = { Common = "일반", Rare = "희귀", Legendary = "전설", Mythical = "신화" }
Config.RarityColors = {
	Common = C(200, 200, 200),
	Rare = C(80, 160, 255),
	Legendary = C(255, 200, 40),
	Mythical = C(255, 70, 200),
}

Config.Fruits = {
	Rubber = {
		Name = "고무 열매",
		Rarity = "Common",
		Color = C(255, 150, 120),
		Skills = {
			M1 = { Damage = 14, Range = 9, Radius = 4.5 },
			Z = { Name = "고무 권총", Type = "Beam", Damage = 45, Range = 35, Width = 2, Cooldown = 4, Level = 1, Knockback = 60 },
			X = { Name = "고무 개틀링", Type = "Barrage", Damage = 12, Hits = 10, Interval = 0.08, Range = 14, Radius = 7, Cooldown = 9, Level = 15 },
			C = { Name = "고무 바주카", Type = "Melee", Damage = 160, Range = 12, Radius = 8, Cooldown = 14, Level = 40, Knockback = 150 },
			V = { Name = "거인의 총", Type = "AOE", Damage = 320, Radius = 20, AtMouse = true, Range = 50, Cooldown = 25, Level = 80, Knockback = 140 },
		},
	},
	Flame = {
		Name = "불꽃 열매",
		Rarity = "Rare",
		Color = C(255, 120, 20),
		Skills = {
			M1 = { Damage = 15, Range = 7, Radius = 5, Burn = { Damage = 2, Ticks = 2 } },
			Z = {
				Name = "화염구",
				Type = "Projectile",
				Damage = 55,
				Speed = 110,
				Range = 100,
				Size = 3,
				Radius = 8,
				Cooldown = 4,
				Level = 1,
				Burn = { Damage = 5, Ticks = 4 },
			},
			X = {
				Name = "불기둥",
				Type = "AOE",
				Damage = 90,
				Radius = 12,
				AtMouse = true,
				Range = 60,
				Cooldown = 9,
				Level = 15,
				Burn = { Damage = 8, Ticks = 5 },
			},
			C = {
				Name = "화염 주먹",
				Type = "Projectile",
				Damage = 200,
				Speed = 90,
				Range = 140,
				Size = 8,
				Radius = 16,
				Cooldown = 15,
				Level = 40,
				Burn = { Damage = 12, Ticks = 5 },
			},
			V = {
				Name = "대분화",
				Type = "Rain",
				Damage = 80,
				Count = 14,
				Radius = 30,
				Range = 60,
				ImpactRadius = 9,
				Duration = 2,
				Cooldown = 26,
				Level = 80,
				Burn = { Damage = 15, Ticks = 4 },
			},
		},
	},
	Ice = {
		Name = "얼음 열매",
		Rarity = "Rare",
		Color = C(140, 220, 255),
		Skills = {
			M1 = { Damage = 15, Range = 7, Radius = 5 },
			Z = { Name = "얼음 창", Type = "Projectile", Damage = 50, Speed = 130, Range = 110, Size = 2, Radius = 6, Cooldown = 4, Level = 1, Stun = 1 },
			X = { Name = "빙결", Type = "AOE", Damage = 70, Radius = 16, Cooldown = 10, Level = 15, Stun = 2.5 },
			C = { Name = "아이스 에이지", Type = "AOE", Damage = 170, Radius = 30, Cooldown = 18, Level = 40, Stun = 3.5 },
			V = {
				Name = "얼음 시대의 창",
				Type = "Rain",
				Damage = 90,
				Count = 12,
				Radius = 25,
				Range = 60,
				ImpactRadius = 8,
				Duration = 1.5,
				Cooldown = 26,
				Level = 80,
				Stun = 1.5,
			},
		},
	},
	Light = {
		Name = "빛 열매",
		Rarity = "Legendary",
		Color = C(255, 245, 140),
		Skills = {
			M1 = { Damage = 17, Range = 8, Radius = 5 },
			Z = { Name = "빛의 광선", Type = "Beam", Damage = 70, Range = 80, Width = 2.5, Cooldown = 4, Level = 1 },
			X = { Name = "광속 이동", Type = "Dash", Damage = 60, Range = 60, Radius = 6, Cooldown = 7, Level = 15 },
			C = {
				Name = "빛의 비",
				Type = "Rain",
				Damage = 70,
				Count = 16,
				Radius = 22,
				Range = 80,
				ImpactRadius = 7,
				Duration = 2,
				Cooldown = 15,
				Level = 40,
			},
			V = {
				Name = "야사카니의 곡옥",
				Type = "Rain",
				Damage = 110,
				Count = 30,
				Radius = 35,
				Range = 80,
				ImpactRadius = 8,
				Duration = 3,
				Cooldown = 28,
				Level = 80,
			},
		},
	},
	Quake = {
		Name = "진동 열매",
		Rarity = "Legendary",
		Color = C(235, 235, 255),
		Skills = {
			M1 = { Damage = 18, Range = 8, Radius = 6, Knockback = 25 },
			Z = { Name = "충격파", Type = "Melee", Damage = 75, Range = 14, Radius = 9, Cooldown = 5, Level = 1, Knockback = 120 },
			X = { Name = "진동 광선", Type = "Beam", Damage = 110, Range = 70, Width = 6, Cooldown = 10, Level = 15, Knockback = 100 },
			C = { Name = "대지진", Type = "AOE", Damage = 220, Radius = 32, Cooldown = 18, Level = 40, Knockback = 160, Stun = 1 },
			V = { Name = "세계를 가르는 일격", Type = "AOE", Damage = 420, Radius = 45, Cooldown = 30, Level = 80, Knockback = 220, Stun = 1.5 },
		},
	},
	Dark = {
		Name = "어둠 열매",
		Rarity = "Mythical",
		Color = C(110, 40, 160),
		Skills = {
			M1 = { Damage = 20, Range = 8, Radius = 6 },
			Z = { Name = "블랙홀", Type = "AOE", Damage = 80, Radius = 18, AtMouse = true, Range = 60, Cooldown = 6, Level = 1, Pull = 60, Stun = 1 },
			X = {
				Name = "어둠의 소용돌이",
				Type = "Barrage",
				Damage = 30,
				Hits = 8,
				Interval = 0.15,
				Range = 0,
				Radius = 18,
				Cooldown = 10,
				Level = 15,
				Pull = 25,
			},
			C = { Name = "해방", Type = "AOE", Damage = 300, Radius = 34, Cooldown = 18, Level = 40, Knockback = 150 },
			V = {
				Name = "흑룡의 심판",
				Type = "Rain",
				Damage = 140,
				Count = 24,
				Radius = 32,
				Range = 80,
				ImpactRadius = 10,
				Duration = 2.5,
				Cooldown = 30,
				Level = 80,
				Pull = 20,
			},
		},
	},
}

Config.SkillKeys = { "Z", "X", "C", "V" }

-- 장착 도구(Kind/Id)에 해당하는 스킬 세트와 색
function Config.GetSkillSet(kind, id)
	if kind == "Combat" then
		return Config.Skills.Combat, Config.Skills.Combat.Color
	elseif kind == "Sword" then
		local sword = Config.Swords[id]
		if sword then
			return Config.Skills.Sword, sword.Color
		end
	elseif kind == "Fruit" then
		local fruit = Config.Fruits[id]
		if fruit then
			return fruit.Skills, fruit.Color
		end
	end
	return nil
end

return Config
