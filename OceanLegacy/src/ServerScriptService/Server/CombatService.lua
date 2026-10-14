-- 기본 공격(M1)과 스킬(Z/X/C/V) 처리 (서버 권한)

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Config = require(ReplicatedStorage.Shared.Config)
local Effects = require(script.Parent.Effects)
local EnemyService = require(script.Parent.EnemyService)
local PlayerService = require(script.Parent.PlayerService)

local Remotes = ReplicatedStorage:WaitForChild("Remotes")

local CombatService = {}

local cooldowns = {} -- [player] = {[key] = readyTime}
local combo = {} -- [player] = {Count, Last}

---------------------------------------------------------------------------
-- 공통
---------------------------------------------------------------------------
local function equipped(player)
	local char = player.Character
	if not char then
		return nil
	end
	local hum = char:FindFirstChildOfClass("Humanoid")
	local root = char:FindFirstChild("HumanoidRootPart")
	local tool = char:FindFirstChildOfClass("Tool")
	if not hum or not root or hum.Health <= 0 or not tool then
		return nil
	end
	local kind, id = tool:GetAttribute("Kind"), tool:GetAttribute("ItemId")
	local set, color = Config.GetSkillSet(kind, id)
	if not set then
		return nil
	end
	return { Player = player, Char = char, Root = root, Kind = kind, Id = id, Set = set, Color = color }
end

local function multiplier(data, kind, id)
	local s = data.Stats
	if kind == "Combat" then
		return 1 + s.Melee * Config.StatScale
	elseif kind == "Sword" then
		return Config.Swords[id].Damage * (1 + s.Sword * Config.StatScale)
	end
	return 1 + s.Fruit * Config.StatScale
end

local function checkCooldown(player, key, duration)
	cooldowns[player] = cooldowns[player] or {}
	local now = os.clock()
	local ready = cooldowns[player][key]
	-- 네트워크 지연 감안해서 약간 여유
	if ready and now < ready - 0.15 then
		return false
	end
	cooldowns[player][key] = now + duration
	return true
end

local function aimDirection(root, target)
	if typeof(target) ~= "Vector3" then
		return root.CFrame.LookVector
	end
	local diff = target - root.Position
	if diff.Magnitude < 0.5 then
		return root.CFrame.LookVector
	end
	return diff.Unit
end

local function flat(v)
	local f = Vector3.new(v.X, 0, v.Z)
	return f.Magnitude > 0.01 and f.Unit or Vector3.new(0, 0, -1)
end

local function hitOpts(ctx, skill, from)
	return {
		From = from,
		Knockback = skill.Knockback,
		Pull = skill.Pull,
		Stun = skill.Stun,
		Burn = skill.Burn,
		BurnScale = ctx.Mult,
		Color = ctx.Kind == "Fruit" and ctx.Color or nil,
	}
end

local function hitArea(ctx, skill, center, radius, damage, already)
	local count = 0
	for _, enemy in EnemyService.FindInRadius(center, radius) do
		if not already or not already[enemy] then
			if already then
				already[enemy] = true
			end
			EnemyService.Damage(enemy, damage, ctx.Player, hitOpts(ctx, skill, center))
			count += 1
		end
	end
	return count
end

local rayParams = RaycastParams.new()
rayParams.FilterType = Enum.RaycastFilterType.Exclude
rayParams.IgnoreWater = true

local function castWorld(from, dir)
	local exclude = { Effects.Folder, EnemyService.Folder }
	for _, p in Players:GetPlayers() do
		if p.Character then
			table.insert(exclude, p.Character)
		end
	end
	rayParams.FilterDescendantsInstances = exclude
	return workspace:Raycast(from, dir, rayParams)
end

local function clampTarget(root, target, range)
	if typeof(target) ~= "Vector3" then
		return root.Position + root.CFrame.LookVector * math.min(range, 20)
	end
	local diff = target - root.Position
	if diff.Magnitude > range then
		return root.Position + diff.Unit * range
	end
	return target
end

---------------------------------------------------------------------------
-- 스킬 타입별 처리
---------------------------------------------------------------------------
local Handlers = {}

function Handlers.Melee(ctx, skill, dmg)
	local dir = flat(ctx.Aim)
	local center = ctx.Root.Position + dir * (skill.Range / 2)
	Effects.Slash(CFrame.lookAt(center, center + dir), skill.Radius * 1.6, ctx.Color)
	if skill.Knockback and skill.Knockback >= 100 then
		Effects.Sphere(center, skill.Radius, ctx.Color, 0.35)
	end
	hitArea(ctx, skill, center, skill.Radius, dmg)
end

function Handlers.Barrage(ctx, skill, dmg)
	task.spawn(function()
		for _ = 1, skill.Hits do
			if not ctx.Root.Parent then
				return
			end
			local dir = flat(ctx.Root.CFrame.LookVector)
			local center = ctx.Root.Position + dir * (skill.Range / 2)
			if skill.Range > 0 then
				Effects.Slash(CFrame.lookAt(center, center + dir) * CFrame.new(math.random(-2, 2), math.random(-1, 2), 0), skill.Radius, ctx.Color, 0.15)
			else
				Effects.Ring(ctx.Root.Position - Vector3.new(0, 2, 0), skill.Radius, ctx.Color, 0.2)
			end
			hitArea(ctx, skill, center, skill.Radius, dmg)
			task.wait(skill.Interval)
		end
	end)
end

function Handlers.AOE(ctx, skill, dmg)
	local center = ctx.Root.Position
	if skill.AtMouse then
		center = clampTarget(ctx.Root, ctx.Target, skill.Range or 50)
	end
	Effects.Sphere(center, skill.Radius, ctx.Color, 0.5)
	Effects.Ring(center - Vector3.new(0, 2, 0), skill.Radius * 1.2, ctx.Color, 0.6)
	if skill.Pull then
		Effects.Sphere(center, skill.Radius * 0.4, Color3.new(0, 0, 0), 1)
	end
	hitArea(ctx, skill, center, skill.Radius, dmg)
end

function Handlers.Projectile(ctx, skill, dmg)
	local dir = ctx.Aim
	local pos = ctx.Root.Position + dir * 3
	local ball = Effects.Projectile(pos, skill.Size, ctx.Color)
	task.spawn(function()
		local traveled = 0
		local hit = {}
		while traveled < skill.Range do
			local dt = RunService.Heartbeat:Wait()
			local step = skill.Speed * dt
			local wall = castWorld(pos, dir * step)
			pos += dir * step
			traveled += step
			ball.CFrame = CFrame.new(pos)
			if skill.Pierce then
				if hitArea(ctx, skill, pos, skill.Radius, dmg, hit) > 0 then
					Effects.Sphere(pos, skill.Radius, ctx.Color, 0.25)
				end
				if wall then
					break
				end
			else
				local touching = #EnemyService.FindInRadius(pos, skill.Size)
				if wall or touching > 0 then
					if wall then
						pos = wall.Position
					end
					Effects.Sphere(pos, skill.Radius, ctx.Color, 0.45)
					hitArea(ctx, skill, pos, skill.Radius, dmg)
					break
				end
			end
		end
		Effects.Fade(ball, 0.2)
	end)
end

local function hitAlongLine(ctx, skill, from, to, radius, dmg)
	local hit = {}
	local len = (to - from).Magnitude
	local steps = math.max(1, math.ceil(len / (radius * 0.8)))
	for i = 0, steps do
		hitArea(ctx, skill, from:Lerp(to, i / steps), radius, dmg, hit)
	end
end

function Handlers.Dash(ctx, skill, dmg)
	local root = ctx.Root
	local dir = flat(ctx.Aim)
	local from = root.Position
	local wall = castWorld(from, dir * skill.Range)
	local dist = wall and math.max(0, (wall.Position - from).Magnitude - 3) or skill.Range
	local to = from + dir * dist
	hitAlongLine(ctx, skill, from, to, skill.Radius, dmg)
	Effects.Beam(from, to, 2, ctx.Color, 0.4)
	root.CFrame = CFrame.lookAt(to, to + dir)
end

function Handlers.Beam(ctx, skill, dmg)
	local dir = ctx.Aim
	local from = ctx.Root.Position + dir * 2
	local wall = castWorld(from, dir * skill.Range)
	local to = wall and wall.Position or from + dir * skill.Range
	Effects.Beam(from, to, skill.Width, ctx.Color, 0.4)
	Effects.Sphere(to, skill.Width * 2, ctx.Color, 0.3)
	hitAlongLine(ctx, skill, from, to, skill.Width + 1.5, dmg)
end

function Handlers.Rain(ctx, skill, dmg)
	local center = clampTarget(ctx.Root, ctx.Target, skill.Range)
	Effects.Ring(center, skill.Radius, ctx.Color, skill.Duration)
	task.spawn(function()
		local interval = skill.Duration / skill.Count
		for _ = 1, skill.Count do
			local a = math.random() * math.pi * 2
			local d = math.sqrt(math.random()) * skill.Radius
			local p = center + Vector3.new(math.cos(a) * d, 0, math.sin(a) * d)
			local ground = castWorld(p + Vector3.new(0, 40, 0), Vector3.new(0, -80, 0))
			local impact = ground and ground.Position or p
			Effects.Beam(impact + Vector3.new(0, 60, 0), impact, 1.5, ctx.Color, 0.25)
			Effects.Sphere(impact, skill.ImpactRadius, ctx.Color, 0.35)
			hitArea(ctx, skill, impact, skill.ImpactRadius, dmg)
			task.wait(interval)
		end
	end)
end

---------------------------------------------------------------------------
-- 원격 처리
---------------------------------------------------------------------------
local function onAttack(player, target)
	local ctx = equipped(player)
	local data = PlayerService.Get(player)
	if not ctx or not data then
		return
	end
	local c = combo[player] or { Count = 0, Last = 0 }
	combo[player] = c
	local now = os.clock()
	if now - c.Last > 1 then
		c.Count = 0
	end
	local finisher = c.Count == 3
	if not checkCooldown(player, "M1", finisher and 0.6 or Config.M1Cooldown) then
		return
	end
	c.Count = (c.Count + 1) % 4
	c.Last = now

	local skill = ctx.Set.M1
	ctx.Aim = aimDirection(ctx.Root, target)
	ctx.Mult = multiplier(data, ctx.Kind, ctx.Id)
	local m1 = table.clone(skill)
	m1.Knockback = finisher and 45 or skill.Knockback
	local dmg = skill.Damage * ctx.Mult * (finisher and 1.5 or 1)
	Handlers.Melee(ctx, m1, dmg)
end

local function onSkill(player, key, target)
	if type(key) ~= "string" then
		return
	end
	local ctx = equipped(player)
	local data = PlayerService.Get(player)
	if not ctx or not data then
		return
	end
	local skill = ctx.Set[key]
	if type(skill) ~= "table" or not skill.Type then
		return
	end
	if data.Level < (skill.Level or 1) then
		PlayerService.Notify(
			player,
			string.format("%s 스킬은 Lv.%d부터 사용할 수 있습니다.", skill.Name, skill.Level),
			Color3.fromRGB(255, 120, 120)
		)
		return
	end
	if not checkCooldown(player, ctx.Kind .. ":" .. tostring(ctx.Id) .. ":" .. key, skill.Cooldown) then
		return
	end
	ctx.Target = target
	ctx.Aim = aimDirection(ctx.Root, target)
	ctx.Mult = multiplier(data, ctx.Kind, ctx.Id)
	local handler = Handlers[skill.Type]
	if handler then
		handler(ctx, skill, skill.Damage * ctx.Mult)
	end
end

function CombatService.Init()
	Remotes.Attack.OnServerEvent:Connect(onAttack)
	Remotes.Skill.OnServerEvent:Connect(onSkill)
	Players.PlayerRemoving:Connect(function(player)
		cooldowns[player] = nil
		combo[player] = nil
	end)
end

return CombatService
