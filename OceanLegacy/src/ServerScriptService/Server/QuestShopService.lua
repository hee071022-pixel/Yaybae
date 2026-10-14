-- 퀘스트, 열매 뽑기, 검 상점, 섬 이동 (NPC 상호작용)

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)
local PlayerService = require(script.Parent.PlayerService)

local Remotes = ReplicatedStorage:WaitForChild("Remotes")

local Service = {}

local npcs = {}
local GOLD = Color3.fromRGB(255, 220, 80)
local RED = Color3.fromRGB(255, 110, 110)
local GREEN = Color3.fromRGB(120, 255, 140)

local function nearRole(player, role)
	local root = player.Character and player.Character:FindFirstChild("HumanoidRootPart")
	if not root then
		return false
	end
	for _, npc in npcs do
		if npc.Role == role and (npc.Position - root.Position).Magnitude < 25 then
			return true
		end
	end
	return false
end

---------------------------------------------------------------------------
-- 퀘스트
---------------------------------------------------------------------------
local function questText(q)
	local e = Config.Enemies[q.Target]
	return string.format("%s %d마리 처치", e.Name, q.Amount)
end

function Service.RequestQuest(player, islandId)
	local data = PlayerService.Get(player)
	if not data then
		return
	end
	data.SpawnIsland = islandId

	local best, lowest
	for _, q in Config.Quests do
		if q.Island == islandId then
			if q.Level <= data.Level and (not best or q.Level > best.Level) then
				best = q
			end
			if not lowest or q.Level < lowest.Level then
				lowest = q
			end
		end
	end
	if not best then
		PlayerService.Notify(player, string.format("이 섬의 퀘스트는 Lv.%d부터 받을 수 있어요.", lowest and lowest.Level or 0), RED)
		PlayerService.Sync(player)
		return
	end
	if data.Quest and data.Quest.Id == best.Id then
		PlayerService.Notify(player, string.format("진행 중: %s (%d/%d)", questText(best), data.Quest.Progress, best.Amount), GOLD)
		return
	end
	data.Quest = { Id = best.Id, Progress = 0 }
	PlayerService.Notify(player, "새 퀘스트: " .. questText(best) .. "  (이 섬이 부활 지점으로 설정됨)", GOLD)
	PlayerService.Sync(player)
end

function Service.OnKill(player, def)
	PlayerService.AddXP(player, def.XP)
	PlayerService.AddBeli(player, def.Beli)
	if def.Boss then
		for _, p in Players:GetPlayers() do
			PlayerService.Notify(
				p,
				string.format("%s님이 보스 [%s]을(를) 처치했습니다!", player.DisplayName, def.Name),
				Color3.fromRGB(255, 120, 60)
			)
		end
	end

	local data = PlayerService.Get(player)
	local active = data and data.Quest
	local q = active and Config.Quests[active.Id]
	if q and q.Target == def.Id then
		active.Progress += 1
		if active.Progress >= q.Amount then
			data.Quest = nil
			PlayerService.Notify(player, string.format("퀘스트 완료! +%d EXP, +%d 벨리", q.XP, q.Beli), GREEN)
			PlayerService.AddBeli(player, q.Beli)
			PlayerService.AddXP(player, q.XP)
		else
			PlayerService.Sync(player)
		end
	end
end

---------------------------------------------------------------------------
-- 열매 뽑기
---------------------------------------------------------------------------
local function rollFruit()
	local pool, total = {}, 0
	for id, fruit in Config.Fruits do
		local w = Config.RarityWeights[fruit.Rarity] or 1
		total += w
		table.insert(pool, { Id = id, W = w })
	end
	table.sort(pool, function(a, b)
		return a.Id < b.Id
	end)
	local r = math.random() * total
	for _, entry in pool do
		r -= entry.W
		if r <= 0 then
			return entry.Id
		end
	end
	return pool[#pool].Id
end

local function buyFruit(player)
	local data = PlayerService.Get(player)
	if not data or not nearRole(player, "Fruit") then
		return
	end
	if data.Beli < Config.FruitPrice then
		PlayerService.Notify(player, "벨리가 부족합니다.", RED)
		return
	end
	data.Beli -= Config.FruitPrice
	local id = rollFruit()
	local fruit = Config.Fruits[id]
	local old = data.Fruit and Config.Fruits[data.Fruit]
	data.Fruit = id
	PlayerService.GiveTools(player)
	PlayerService.Notify(
		player,
		string.format("[%s] %s 획득!%s", Config.RarityNames[fruit.Rarity], fruit.Name, old and (" (" .. old.Name .. " 교체됨)") or ""),
		Config.RarityColors[fruit.Rarity]
	)
	PlayerService.Sync(player)
	Remotes.OpenShop:FireClient(player, "FruitResult", id)
end

---------------------------------------------------------------------------
-- 검 상점
---------------------------------------------------------------------------
local function buySword(player, id)
	local data = PlayerService.Get(player)
	local sword = type(id) == "string" and Config.Swords[id]
	if not data or not sword or not nearRole(player, "Sword") then
		return
	end
	if table.find(data.Swords, id) then
		PlayerService.Notify(player, "이미 가지고 있는 검입니다.", RED)
		return
	end
	if data.Beli < sword.Price then
		PlayerService.Notify(player, "벨리가 부족합니다.", RED)
		return
	end
	data.Beli -= sword.Price
	table.insert(data.Swords, id)
	PlayerService.GiveTools(player)
	PlayerService.Notify(player, sword.Name .. " 구매 완료!", GREEN)
	PlayerService.Sync(player)
end

---------------------------------------------------------------------------
-- 섬 이동
---------------------------------------------------------------------------
local function travel(player, islandId)
	local data = PlayerService.Get(player)
	local island = type(islandId) == "string" and Config.IslandById[islandId]
	local char = player.Character
	if not data or not island or not char or not nearRole(player, "Travel") then
		return
	end
	if data.Level < island.Level then
		PlayerService.Notify(player, string.format("%s은(는) Lv.%d부터 갈 수 있습니다.", island.Name, island.Level), RED)
		return
	end
	local spawns = Service.World.Spawns
	char:PivotTo(spawns[island.Id] * CFrame.new(math.random(-6, 6), 0, math.random(-6, 6)))
	PlayerService.Notify(player, island.Name .. "에 도착했습니다!", Color3.fromRGB(120, 220, 255))
end

---------------------------------------------------------------------------
function Service.Init(world)
	Service.World = world
	npcs = world.NPCs
	for _, npc in npcs do
		npc.Prompt.Triggered:Connect(function(player)
			if npc.Role == "Quest" then
				Service.RequestQuest(player, npc.Island)
			elseif npc.Role == "Fruit" then
				Remotes.OpenShop:FireClient(player, "Fruit")
			elseif npc.Role == "Sword" then
				Remotes.OpenShop:FireClient(player, "Sword")
			elseif npc.Role == "Travel" then
				Remotes.OpenShop:FireClient(player, "Travel")
			end
		end)
	end
	Remotes.BuyFruit.OnServerEvent:Connect(buyFruit)
	Remotes.BuySword.OnServerEvent:Connect(buySword)
	Remotes.Travel.OnServerEvent:Connect(travel)
end

return Service
