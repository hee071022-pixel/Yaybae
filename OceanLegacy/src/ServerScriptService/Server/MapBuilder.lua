-- 바다와 섬을 Terrain + 파트로 생성

local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)
local Rig = require(script.Parent.Rig)

local MapBuilder = {}

local C = Color3.fromRGB
local rng = Random.new(20261014)
local terrain = workspace.Terrain
local mapFolder

local Themes = {
	Starter = { Shore = Enum.Material.Sand, Ground = Enum.Material.Grass, Decor = { Palm = 16, House = 4, Rock = 6 } },
	Jungle = { Shore = Enum.Material.Sand, Ground = Enum.Material.LeafyGrass, Decor = { Tree = 40, Rock = 10 } },
	Desert = { Shore = Enum.Material.Sandstone, Ground = Enum.Material.Sand, Decor = { Cactus = 22, Rock = 8, Pyramid = 1 } },
	Snow = { Shore = Enum.Material.Rock, Ground = Enum.Material.Snow, Decor = { Pine = 30, Crystal = 10 } },
	Marine = { Shore = Enum.Material.Rock, Ground = Enum.Material.Pavement, Decor = { Tower = 6, Crate = 12 }, Walls = true },
}

-- 역할별 NPC 설정
local NpcInfo = {
	Quest = {
		Title = "퀘스트 안내원",
		Action = "퀘스트 받기",
		Skin = C(234, 184, 146),
		Shirt = C(60, 120, 220),
		Pants = C(40, 40, 60),
		Color = C(255, 220, 80),
	},
	Travel = {
		Title = "항해사",
		Action = "다른 섬으로 이동",
		Skin = C(204, 142, 105),
		Shirt = C(240, 240, 240),
		Pants = C(30, 50, 120),
		Color = C(120, 220, 255),
	},
	Fruit = {
		Title = "열매 상인",
		Action = "악마의 열매 뽑기",
		Skin = C(234, 184, 146),
		Shirt = C(150, 50, 200),
		Pants = C(60, 20, 80),
		Color = C(230, 120, 255),
	},
	Sword = { Title = "대장장이", Action = "검 상점", Skin = C(204, 142, 105), Shirt = C(90, 90, 90), Pants = C(50, 35, 25), Color = C(200, 200, 210) },
}

---------------------------------------------------------------------------
-- 유틸
---------------------------------------------------------------------------
local function part(parent, props)
	local p = Instance.new("Part")
	p.Anchored = true
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	for k, v in props do
		p[k] = v
	end
	p.Parent = parent
	return p
end

local groundParams = RaycastParams.new()
groundParams.FilterType = Enum.RaycastFilterType.Include
groundParams.IgnoreWater = true

local function groundAt(x, z)
	groundParams.FilterDescendantsInstances = { terrain, mapFolder }
	local result = workspace:Raycast(Vector3.new(x, 300, z), Vector3.new(0, -400, 0), groundParams)
	if result then
		return result.Position
	end
	return Vector3.new(x, Config.GroundY, z)
end
MapBuilder.GroundAt = groundAt

local function randomPointOnIsland(island, minDist, maxFrac, avoid)
	local c = island.Center
	for _ = 1, 30 do
		local angle = rng:NextNumber(0, math.pi * 2)
		local dist = rng:NextNumber(minDist, island.Radius * maxFrac)
		local x, z = c.X + math.cos(angle) * dist, c.Z + math.sin(angle) * dist
		local ok = true
		for _, a in avoid do
			if (Vector2.new(x, z) - Vector2.new(a.Position.X, a.Position.Z)).Magnitude < a.Radius then
				ok = false
				break
			end
		end
		if ok then
			return x, z
		end
	end
	return nil
end

---------------------------------------------------------------------------
-- 장식물
---------------------------------------------------------------------------
local Decor = {}

function Decor.Palm(parent, pos)
	local h = rng:NextNumber(12, 18)
	local lean = CFrame.Angles(math.rad(rng:NextNumber(-10, 10)), rng:NextNumber(0, 6.28), math.rad(rng:NextNumber(-10, 10)))
	local base = CFrame.new(pos) * lean
	part(parent, { Size = Vector3.new(1.6, h, 1.6), CFrame = base * CFrame.new(0, h / 2, 0), Color = C(140, 100, 60), Material = Enum.Material.Wood })
	for i = 1, 5 do
		local a = CFrame.Angles(0, math.rad(i * 72), 0)
		part(parent, {
			Size = Vector3.new(2, 0.4, 9),
			CFrame = base * CFrame.new(0, h, 0) * a * CFrame.new(0, 0, -4) * CFrame.Angles(math.rad(-20), 0, 0),
			Color = C(60, 160, 60),
			Material = Enum.Material.Grass,
		})
	end
end

function Decor.Tree(parent, pos)
	local h = rng:NextNumber(14, 24)
	part(
		parent,
		{ Size = Vector3.new(2.5, h, 2.5), CFrame = CFrame.new(pos + Vector3.new(0, h / 2, 0)), Color = C(110, 75, 45), Material = Enum.Material.Wood }
	)
	local r = rng:NextNumber(9, 14)
	part(parent, {
		Shape = Enum.PartType.Ball,
		Size = Vector3.one * r,
		CFrame = CFrame.new(pos + Vector3.new(0, h, 0)),
		Color = C(40, rng:NextInteger(110, 150), 40),
		Material = Enum.Material.Grass,
	})
	part(parent, {
		Shape = Enum.PartType.Ball,
		Size = Vector3.one * r * 0.7,
		CFrame = CFrame.new(pos + Vector3.new(r * 0.35, h - 2, 0)),
		Color = C(50, 130, 45),
		Material = Enum.Material.Grass,
	})
end

function Decor.Pine(parent, pos)
	local h = rng:NextNumber(10, 16)
	part(parent, { Size = Vector3.new(1.6, h, 1.6), CFrame = CFrame.new(pos + Vector3.new(0, h / 2, 0)), Color = C(90, 60, 40), Material = Enum.Material.Wood })
	for i = 0, 2 do
		local s = 10 - i * 3
		part(parent, {
			Shape = Enum.PartType.Ball,
			Size = Vector3.new(s, s * 0.6, s),
			CFrame = CFrame.new(pos + Vector3.new(0, h * 0.45 + i * 3.5, 0)),
			Color = C(235, 245, 255),
			Material = Enum.Material.Snow,
		})
	end
end

function Decor.Cactus(parent, pos)
	local h = rng:NextNumber(6, 11)
	local color = C(70, 140, 60)
	part(parent, {
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(h, 2, 2),
		CFrame = CFrame.new(pos + Vector3.new(0, h / 2, 0)) * CFrame.Angles(0, 0, math.rad(90)),
		Color = color,
		Material = Enum.Material.Grass,
	})
	local side = rng:NextInteger(0, 1) == 0 and -1 or 1
	part(parent, {
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(3, 1.4, 1.4),
		CFrame = CFrame.new(pos + Vector3.new(side * 1.6, h * 0.55, 0)),
		Color = color,
		Material = Enum.Material.Grass,
	})
	part(parent, {
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(3, 1.4, 1.4),
		CFrame = CFrame.new(pos + Vector3.new(side * 3, h * 0.55 + 1.5, 0)) * CFrame.Angles(0, 0, math.rad(90)),
		Color = color,
		Material = Enum.Material.Grass,
	})
end

function Decor.Rock(parent, pos)
	local s = rng:NextNumber(4, 9)
	part(parent, {
		Size = Vector3.new(s, s * 0.7, s * 0.9),
		CFrame = CFrame.new(pos + Vector3.new(0, s * 0.25, 0)) * CFrame.Angles(rng:NextNumber(-0.3, 0.3), rng:NextNumber(0, 6.28), rng:NextNumber(-0.3, 0.3)),
		Color = C(110, 110, 115),
		Material = Enum.Material.Slate,
	})
end

function Decor.Crystal(parent, pos)
	local h = rng:NextNumber(6, 12)
	part(parent, {
		Size = Vector3.new(2.5, h, 2.5),
		CFrame = CFrame.new(pos + Vector3.new(0, h / 2 - 1, 0)) * CFrame.Angles(rng:NextNumber(-0.3, 0.3), rng:NextNumber(0, 6.28), rng:NextNumber(-0.3, 0.3)),
		Color = C(150, 220, 255),
		Material = Enum.Material.Ice,
		Transparency = 0.2,
	})
end

function Decor.Crate(parent, pos)
	local s = rng:NextNumber(3, 5)
	part(parent, {
		Size = Vector3.one * s,
		CFrame = CFrame.new(pos + Vector3.new(0, s / 2, 0)) * CFrame.Angles(0, rng:NextNumber(0, 6.28), 0),
		Color = C(150, 110, 60),
		Material = Enum.Material.WoodPlanks,
	})
end

function Decor.House(parent, pos)
	local yaw = CFrame.Angles(0, rng:NextNumber(0, 6.28), 0)
	local base = CFrame.new(pos) * yaw
	part(parent, { Size = Vector3.new(16, 10, 14), CFrame = base * CFrame.new(0, 5, 0), Color = C(220, 200, 160), Material = Enum.Material.WoodPlanks })
	local roofColor = C(170, 60, 50)
	part(parent, {
		Size = Vector3.new(18, 1, 10),
		CFrame = base * CFrame.new(0, 12.2, -3.6) * CFrame.Angles(math.rad(35), 0, 0),
		Color = roofColor,
		Material = Enum.Material.Slate,
	})
	part(parent, {
		Size = Vector3.new(18, 1, 10),
		CFrame = base * CFrame.new(0, 12.2, 3.6) * CFrame.Angles(math.rad(-35), 0, 0),
		Color = roofColor,
		Material = Enum.Material.Slate,
	})
	part(parent, { Size = Vector3.new(4, 7, 0.4), CFrame = base * CFrame.new(0, 3.5, -7.1), Color = C(100, 70, 40), Material = Enum.Material.Wood })
end

function Decor.Tower(parent, pos)
	local h = rng:NextNumber(25, 35)
	part(parent, {
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(h, 12, 12),
		CFrame = CFrame.new(pos + Vector3.new(0, h / 2, 0)) * CFrame.Angles(0, 0, math.rad(90)),
		Color = C(200, 200, 205),
		Material = Enum.Material.Concrete,
	})
	part(parent, {
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(2, 14, 14),
		CFrame = CFrame.new(pos + Vector3.new(0, h + 1, 0)) * CFrame.Angles(0, 0, math.rad(90)),
		Color = C(40, 70, 150),
		Material = Enum.Material.Concrete,
	})
	part(
		parent,
		{ Size = Vector3.new(0.5, 10, 0.5), CFrame = CFrame.new(pos + Vector3.new(0, h + 7, 0)), Color = C(80, 80, 80), Material = Enum.Material.Metal }
	)
	part(
		parent,
		{ Size = Vector3.new(0.2, 3, 5), CFrame = CFrame.new(pos + Vector3.new(0, h + 10, 2.6)), Color = C(30, 80, 200), Material = Enum.Material.Fabric }
	)
end

function Decor.Pyramid(parent, pos)
	for i = 0, 7 do
		local s = 50 - i * 6
		part(parent, {
			Size = Vector3.new(s, 4, s),
			CFrame = CFrame.new(pos + Vector3.new(0, i * 4 + 2, 0)),
			Color = C(220, 190, 120),
			Material = Enum.Material.Sandstone,
		})
	end
end

local function marineWalls(parent, island)
	local c = island.Center
	local r = island.Radius * 0.88
	local segments = 28
	for i = 0, segments - 1 do
		-- 출입구용 틈
		if i % 7 ~= 0 then
			local a = (i + 0.5) / segments * math.pi * 2
			local x, z = c.X + math.cos(a) * r, c.Z + math.sin(a) * r
			local g = groundAt(x, z)
			local len = 2 * math.pi * r / segments + 1
			part(parent, {
				Size = Vector3.new(len, 14, 4),
				CFrame = CFrame.new(g + Vector3.new(0, 6, 0)) * CFrame.Angles(0, -a + math.pi / 2, 0),
				Color = C(215, 215, 220),
				Material = Enum.Material.Concrete,
			})
		end
	end
end

---------------------------------------------------------------------------
-- NPC
---------------------------------------------------------------------------
local function createNpc(role, island, position, faceTo)
	local info = NpcInfo[role]
	local model = Rig.Create("Npc_" .. role, info)
	model.Name = info.Title
	local root = model:FindFirstChild("HumanoidRootPart")
	root.Anchored = true
	local ground = groundAt(position.X, position.Z)
	local rootPos = ground + Vector3.new(0, Rig.RootHeight(model), 0)
	model:PivotTo(CFrame.lookAt(rootPos, Vector3.new(faceTo.X, rootPos.Y, faceTo.Z)))
	model:SetAttribute("Role", role)
	model:SetAttribute("Island", island.Id)
	Rig.Nameplate(model, info.Title, info.Color, false)

	local prompt = Instance.new("ProximityPrompt")
	prompt.ActionText = info.Action
	prompt.ObjectText = info.Title
	prompt.KeyboardKeyCode = Enum.KeyCode.E
	prompt.HoldDuration = 0
	prompt.MaxActivationDistance = 12
	prompt.RequiresLineOfSight = false
	prompt.Parent = root

	model.Parent = mapFolder.NPCs
	return { Role = role, Island = island.Id, Model = model, Prompt = prompt, Position = rootPos }
end

---------------------------------------------------------------------------
-- 빌드
---------------------------------------------------------------------------
local function setupLighting()
	Lighting.ClockTime = 14
	Lighting.Brightness = 2.5
	Lighting.OutdoorAmbient = C(150, 150, 160)
	Lighting.GlobalShadows = true
	if not Lighting:FindFirstChildOfClass("Atmosphere") then
		local atm = Instance.new("Atmosphere")
		atm.Density = 0.28
		atm.Haze = 1
		atm.Color = C(200, 225, 255)
		atm.Decay = C(110, 150, 200)
		atm.Parent = Lighting
	end
	terrain.WaterColor = C(20, 120, 190)
	terrain.WaterTransparency = 0.6
	terrain.WaterWaveSize = 0.3
	terrain.WaterWaveSpeed = 12
end

local function buildSea()
	-- 큰 영역은 나눠서 채움
	local minX, maxX = -560, 3280
	local chunk = 480
	for x = minX, maxX - 1, chunk do
		local cx = x + chunk / 2
		terrain:FillBlock(CFrame.new(cx, -36, 0), Vector3.new(chunk, 8, 1400), Enum.Material.Sand)
		terrain:FillBlock(CFrame.new(cx, -16, 0), Vector3.new(chunk, 32, 1400), Enum.Material.Water)
	end
end

local function buildIsland(island, world)
	local theme = Themes[island.Theme]
	local c = island.Center
	local R = island.Radius
	local folder = Instance.new("Folder")
	folder.Name = island.Id
	folder.Parent = mapFolder

	-- 지형
	terrain:FillCylinder(CFrame.new(c.X, -14, c.Z), 44, R, theme.Shore)
	terrain:FillCylinder(CFrame.new(c.X, 6, c.Z), 4, R - 18, theme.Ground)
	for i = 1, 5 do
		local a = rng:NextNumber(0, math.pi * 2)
		local d = rng:NextNumber(R * 0.7, R * 0.82)
		terrain:FillBall(Vector3.new(c.X + math.cos(a) * d, 2, c.Z + math.sin(a) * d), rng:NextNumber(12, 20), theme.Ground)
	end

	-- 광장 + 스폰 지점
	local plaza = part(folder, {
		Name = "Plaza",
		Size = Vector3.new(44, 1, 44),
		CFrame = CFrame.new(c.X, Config.GroundY + 0.4, c.Z),
		Color = island.Theme == "Marine" and C(60, 70, 110) or C(150, 110, 70),
		Material = island.Theme == "Marine" and Enum.Material.Slate or Enum.Material.WoodPlanks,
	})
	world.Spawns[island.Id] = CFrame.new(plaza.Position + Vector3.new(0, 4, 0))

	-- 섬 이름 간판
	local sign = part(
		folder,
		{ Name = "Sign", Size = Vector3.new(1, 1, 1), Transparency = 1, CanCollide = false, CFrame = CFrame.new(plaza.Position + Vector3.new(0, 22, 0)) }
	)
	local bb = Instance.new("BillboardGui")
	bb.Size = UDim2.fromOffset(360, 70)
	bb.MaxDistance = 400
	bb.Parent = sign
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Size = UDim2.fromScale(1, 1)
	label.Font = Enum.Font.GothamBlack
	label.TextScaled = true
	label.TextColor3 = C(255, 255, 255)
	label.TextStrokeTransparency = 0
	label.Text = string.format("%s  (Lv.%d+)", island.Name, island.Level)
	label.Parent = bb

	-- 적 무리 배치: 일반 몹은 섬 둘레에, 보스는 마지막
	local enemies = {}
	for id, e in Config.Enemies do
		if e.Island == island.Id then
			table.insert(enemies, e)
		end
	end
	table.sort(enemies, function(a, b)
		return a.Level < b.Level
	end)

	local avoid = { { Position = c, Radius = 34 } }
	local startAngle = rng:NextNumber(0, math.pi * 2)
	for i, e in enemies do
		local a = startAngle + (i - 1) / #enemies * math.pi * 2
		local dist = R * (e.Boss and 0.6 or 0.5)
		local gc = Vector3.new(c.X + math.cos(a) * dist, 0, c.Z + math.sin(a) * dist)
		table.insert(avoid, { Position = gc, Radius = 22 })
		for _ = 1, e.Count do
			local spread = e.Boss and 0 or 16
			local x = gc.X + rng:NextNumber(-spread, spread)
			local z = gc.Z + rng:NextNumber(-spread, spread)
			table.insert(world.EnemySpawns, { EnemyId = e.Id, Position = groundAt(x, z) })
		end
		if e.Boss then
			-- 보스 구역 표시 고리
			local g = groundAt(gc.X, gc.Z)
			part(folder, {
				Name = "BossArena",
				Shape = Enum.PartType.Cylinder,
				Size = Vector3.new(0.6, 36, 36),
				CFrame = CFrame.new(g + Vector3.new(0, 0.1, 0)) * CFrame.Angles(0, 0, math.rad(90)),
				Color = C(150, 30, 30),
				Material = Enum.Material.Slate,
				CanCollide = false,
			})
		end
	end

	-- 장식
	if theme.Walls then
		marineWalls(folder, island)
	end
	for kind, count in theme.Decor do
		for _ = 1, count do
			local minDist = kind == "Pyramid" and R * 0.3 or 30
			local x, z = randomPointOnIsland(island, minDist, kind == "Pyramid" and 0.4 or 0.8, avoid)
			if x then
				local g = groundAt(x, z)
				Decor[kind](folder, g)
				table.insert(avoid, { Position = g, Radius = kind == "Pyramid" and 34 or (kind == "House" or kind == "Tower") and 14 or 5 })
			end
		end
	end

	-- NPC
	local roles = { "Quest", "Travel" }
	if island.Id == "Starter" then
		table.insert(roles, "Fruit")
		table.insert(roles, "Sword")
	elseif island.Id == "Marine" or island.Id == "Desert" then
		table.insert(roles, "Sword")
	end
	local corners = { Vector3.new(-14, 0, -14), Vector3.new(14, 0, -14), Vector3.new(-14, 0, 14), Vector3.new(14, 0, 14) }
	for i, role in roles do
		local pos = plaza.Position + corners[i]
		table.insert(world.NPCs, createNpc(role, island, pos, plaza.Position))
	end
end

function MapBuilder.Build()
	mapFolder = Instance.new("Folder")
	mapFolder.Name = "Map"
	local npcs = Instance.new("Folder")
	npcs.Name = "NPCs"
	npcs.Parent = mapFolder
	mapFolder.Parent = workspace

	setupLighting()
	buildSea()

	local world = { Spawns = {}, EnemySpawns = {}, NPCs = {} }
	for _, island in Config.Islands do
		buildIsland(island, world)
	end
	return world
end

return MapBuilder
