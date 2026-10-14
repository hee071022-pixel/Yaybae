-- 플레이어 데이터(저장/불러오기), 레벨업, 스탯, 도구 지급, 캐릭터 스폰

local Players = game:GetService("Players")
local DataStoreService = game:GetService("DataStoreService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)
local Effects = require(script.Parent.Effects)

local Remotes = ReplicatedStorage:WaitForChild("Remotes")

local PlayerService = {}

local profiles = {} -- [player] = data
local world

local store
do
	local ok, result = pcall(function()
		return DataStoreService:GetDataStore("OceanLegacy_v1")
	end)
	if ok then
		store = result
	else
		warn("[PlayerService] DataStore 사용 불가 (Studio에서는 게임 설정 > 보안 > API 서비스 허용 필요):", result)
	end
end

local function defaultData()
	return {
		Level = 1,
		XP = 0,
		Beli = Config.StartBeli,
		Points = 0,
		Stats = { Melee = 0, Defense = 0, Sword = 0, Fruit = 0 },
		Swords = {},
		Fruit = nil,
		Quest = nil,
		SpawnIsland = "Starter",
	}
end

local function reconcile(data, template)
	for k, v in template do
		if data[k] == nil then
			data[k] = v
		elseif type(v) == "table" and type(data[k]) == "table" then
			reconcile(data[k], v)
		end
	end
	return data
end

---------------------------------------------------------------------------
-- 공용 API
---------------------------------------------------------------------------
function PlayerService.Get(player)
	return profiles[player]
end

function PlayerService.Notify(player, text, color)
	Remotes.Notify:FireClient(player, text, color)
end

function PlayerService.Sync(player)
	local data = profiles[player]
	if not data then
		return
	end
	Remotes.Data:FireClient(player, data)
	local ls = player:FindFirstChild("leaderstats")
	if ls then
		ls.Level.Value = data.Level
		ls.Beli.Value = data.Beli
	end
end

function PlayerService.ApplyStats(player, heal)
	local data = profiles[player]
	local char = player.Character
	local hum = char and char:FindFirstChildOfClass("Humanoid")
	if not data or not hum or hum.Health <= 0 then
		return
	end
	local ratio = hum.Health / math.max(1, hum.MaxHealth)
	hum.MaxHealth = Config.MaxHealth(data.Level, data.Stats.Defense)
	hum.Health = heal and hum.MaxHealth or hum.MaxHealth * ratio
end

function PlayerService.AddBeli(player, amount)
	local data = profiles[player]
	if not data then
		return
	end
	data.Beli += amount
	PlayerService.Sync(player)
end

function PlayerService.AddXP(player, amount)
	local data = profiles[player]
	if not data then
		return
	end
	if data.Level >= Config.MaxLevel then
		return
	end
	data.XP += amount
	local leveled = false
	while data.Level < Config.MaxLevel and data.XP >= Config.XPForLevel(data.Level) do
		data.XP -= Config.XPForLevel(data.Level)
		data.Level += 1
		data.Points += Config.StatPointsPerLevel
		leveled = true
	end
	if data.Level >= Config.MaxLevel then
		data.XP = 0
	end
	if leveled then
		PlayerService.ApplyStats(player, true)
		PlayerService.Notify(
			player,
			string.format("레벨 업! Lv.%d (스탯 포인트 +%d)", data.Level, Config.StatPointsPerLevel),
			Color3.fromRGB(255, 220, 60)
		)
		local root = player.Character and player.Character:FindFirstChild("HumanoidRootPart")
		if root then
			Effects.LevelUp(root)
		end
	end
	PlayerService.Sync(player)
end

function PlayerService.AddStat(player, stat, amount)
	local data = profiles[player]
	if not data or type(stat) ~= "string" or data.Stats[stat] == nil then
		return
	end
	amount = math.floor(tonumber(amount) or 0)
	amount = math.clamp(amount, 0, data.Points)
	if amount <= 0 then
		return
	end
	data.Points -= amount
	data.Stats[stat] += amount
	PlayerService.ApplyStats(player, false)
	PlayerService.Sync(player)
end

---------------------------------------------------------------------------
-- 도구
---------------------------------------------------------------------------
local function makeTool(name, kind, id, tip)
	local tool = Instance.new("Tool")
	tool.Name = name
	tool.CanBeDropped = false
	tool.ToolTip = tip or ""
	tool:SetAttribute("Kind", kind)
	tool:SetAttribute("ItemId", id)
	tool.RequiresHandle = false
	return tool
end

local function makeSword(id)
	local def = Config.Swords[id]
	local tool = makeTool(def.Name, "Sword", id, "검 스킬: Z / X / C")
	tool.RequiresHandle = true
	tool.Grip = CFrame.new(0, 0, -def.Length / 2 + 0.6, 0, 0, 1, 1, 0, 0, 0, 1, 0)

	local blade = Instance.new("Part")
	blade.Name = "Handle"
	blade.Size = Vector3.new(0.25, 0.6, def.Length)
	blade.Color = def.Color
	blade.Material = def.Neon and Enum.Material.Neon or Enum.Material.Metal
	blade.CanCollide = false
	blade.Massless = true
	blade.Parent = tool

	local function attach(name, size, offset, color, material)
		local p = Instance.new("Part")
		p.Name = name
		p.Size = size
		p.Color = color
		p.Material = material
		p.CanCollide = false
		p.Massless = true
		p.CFrame = blade.CFrame * offset
		local weld = Instance.new("WeldConstraint")
		weld.Part0 = blade
		weld.Part1 = p
		weld.Parent = p
		p.Parent = tool
	end
	local hiltZ = -def.Length / 2
	attach("Guard", Vector3.new(0.4, 1.6, 0.3), CFrame.new(0, 0, hiltZ + 1), Color3.fromRGB(200, 170, 60), Enum.Material.Metal)
	attach("Hilt", Vector3.new(0.35, 0.35, 1.2), CFrame.new(0, 0, hiltZ + 0.3), Color3.fromRGB(50, 30, 20), Enum.Material.Fabric)
	return tool
end

function PlayerService.GiveTools(player)
	local data = profiles[player]
	local backpack = player:FindFirstChildOfClass("Backpack") or player:WaitForChild("Backpack", 5)
	if not data or not backpack then
		return
	end
	-- 기존 도구 정리 (캐릭터가 들고 있는 것 포함)
	for _, container in { backpack, player.Character } do
		if container then
			for _, t in container:GetChildren() do
				if t:IsA("Tool") and t:GetAttribute("Kind") then
					t:Destroy()
				end
			end
		end
	end

	makeTool("주먹", "Combat", "Combat", "격투 스킬: Z / X / C").Parent = backpack
	table.sort(data.Swords, function(a, b)
		local sa, sb = Config.Swords[a], Config.Swords[b]
		return (sa and sa.Order or 0) < (sb and sb.Order or 0)
	end)
	for _, id in data.Swords do
		if Config.Swords[id] then
			makeSword(id).Parent = backpack
		end
	end
	if data.Fruit and Config.Fruits[data.Fruit] then
		makeTool(Config.Fruits[data.Fruit].Name, "Fruit", data.Fruit, "열매 스킬: Z / X / C / V").Parent = backpack
	end
end

---------------------------------------------------------------------------
-- 캐릭터 / 접속
---------------------------------------------------------------------------
function PlayerService.SpawnCFrame(player)
	local data = profiles[player]
	local id = data and data.SpawnIsland or "Starter"
	return world.Spawns[id] or world.Spawns.Starter
end

local function onCharacter(player, char)
	local hum = char:WaitForChild("Humanoid")
	local root = char:WaitForChild("HumanoidRootPart")
	hum.WalkSpeed = Config.WalkSpeed
	hum.UseJumpPower = true
	hum.JumpPower = Config.JumpPower

	task.defer(function()
		local cf = PlayerService.SpawnCFrame(player)
		char:PivotTo(cf * CFrame.new(math.random(-8, 8), 0, math.random(-8, 8)))
	end)

	PlayerService.ApplyStats(player, true)
	PlayerService.GiveTools(player)

	hum.Died:Connect(function()
		task.delay(Config.RespawnTime, function()
			if player.Parent then
				player:LoadCharacter()
			end
		end)
	end)

	-- 바다 깊이 빠졌을 때 구조
	task.spawn(function()
		while char.Parent and hum.Health > 0 do
			task.wait(1)
			if root.Position.Y < -45 then
				char:PivotTo(PlayerService.SpawnCFrame(player))
			end
		end
	end)
end

local function save(player)
	local data = profiles[player]
	if not data or not store or data._NoSave then
		return
	end
	local copy = table.clone(data)
	copy._NoSave = nil
	local ok, err = pcall(function()
		store:SetAsync("p_" .. player.UserId, copy)
	end)
	if not ok then
		warn("[PlayerService] 저장 실패:", player.Name, err)
	end
end
PlayerService.Save = save

local function onPlayerAdded(player)
	local data
	local loadFailed = false
	if store then
		local ok, result = pcall(function()
			return store:GetAsync("p_" .. player.UserId)
		end)
		if ok then
			if type(result) == "table" then
				data = result
			end
		else
			loadFailed = true
			warn("[PlayerService] 불러오기 실패:", result)
		end
	end
	data = reconcile(data or defaultData(), defaultData())
	if loadFailed then
		-- 불러오기에 실패하면 기존 저장을 덮어쓰지 않음
		data._NoSave = true
	end
	if not player.Parent then
		return
	end
	profiles[player] = data

	local ls = Instance.new("Folder")
	ls.Name = "leaderstats"
	local lv = Instance.new("IntValue")
	lv.Name = "Level"
	lv.Value = data.Level
	lv.Parent = ls
	local beli = Instance.new("IntValue")
	beli.Name = "Beli"
	beli.Value = data.Beli
	beli.Parent = ls
	ls.Parent = player

	player.CharacterAdded:Connect(function(char)
		onCharacter(player, char)
	end)
	player:LoadCharacter()
	PlayerService.Sync(player)
	if data.Level == 1 and data.XP == 0 then
		PlayerService.Notify(
			player,
			"오션 레거시에 오신 걸 환영합니다! 광장의 퀘스트 안내원(E)에게 말을 걸어보세요.",
			Color3.fromRGB(120, 220, 255)
		)
	end
end

function PlayerService.Init(builtWorld)
	world = builtWorld
	Players.PlayerAdded:Connect(onPlayerAdded)
	for _, p in Players:GetPlayers() do
		task.spawn(onPlayerAdded, p)
	end
	Players.PlayerRemoving:Connect(function(player)
		save(player)
		profiles[player] = nil
	end)
	game:BindToClose(function()
		for _, p in Players:GetPlayers() do
			save(p)
		end
	end)
	task.spawn(function()
		while true do
			task.wait(120)
			for _, p in Players:GetPlayers() do
				save(p)
			end
		end
	end)

	Remotes.RequestData.OnServerEvent:Connect(PlayerService.Sync)
	Remotes.AddStat.OnServerEvent:Connect(PlayerService.AddStat)
end

return PlayerService
