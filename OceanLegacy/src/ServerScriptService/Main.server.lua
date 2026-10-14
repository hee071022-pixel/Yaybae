-- 오션 레거시 서버 진입점

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

Players.CharacterAutoLoads = false

-- 원격 이벤트 생성 (모듈보다 먼저)
local remotes = Instance.new("Folder")
remotes.Name = "Remotes"
for _, name in
	{
		"Attack",
		"Skill",
		"AddStat",
		"BuyFruit",
		"BuySword",
		"Travel",
		"RequestData",
		"Data",
		"Notify",
		"OpenShop",
	}
do
	local r = Instance.new("RemoteEvent")
	r.Name = name
	r.Parent = remotes
end
remotes.Parent = ReplicatedStorage

local Server = script.Parent:WaitForChild("Server")
local MapBuilder = require(Server.MapBuilder)
local EnemyService = require(Server.EnemyService)
local PlayerService = require(Server.PlayerService)
local CombatService = require(Server.CombatService)
local QuestShopService = require(Server.QuestShopService)

local world = MapBuilder.Build()

EnemyService.OnKilled = QuestShopService.OnKill
EnemyService.Init(world.EnemySpawns)
CombatService.Init()
QuestShopService.Init(world)
PlayerService.Init(world)

print(string.format("[OceanLegacy] 서버 준비 완료: 적 %d마리, NPC %d명", #world.EnemySpawns, #world.NPCs))
