-- 적 생성, AI, 피격, 처치 보상

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)
local Rig = require(script.Parent.Rig)
local Effects = require(script.Parent.Effects)

local EnemyService = {}

-- 처치 시 호출: function(player, enemyDef)
EnemyService.OnKilled = nil

local folder = Instance.new("Folder")
folder.Name = "Enemies"
folder.Parent = workspace
EnemyService.Folder = folder

local records = {} -- [model] = record

local WALK_ANIM = "rbxassetid://507777826"
local IDLE_ANIM = "rbxassetid://507766388"

local overlap = OverlapParams.new()
overlap.FilterType = Enum.RaycastFilterType.Include
overlap.FilterDescendantsInstances = { folder }

---------------------------------------------------------------------------
-- 검색
---------------------------------------------------------------------------
function EnemyService.FindInRadius(pos, radius)
	local list, seen = {}, {}
	for _, p in workspace:GetPartBoundsInRadius(pos, radius, overlap) do
		local model = p:FindFirstAncestorOfClass("Model")
		while model and model.Parent ~= folder do
			model = model:FindFirstAncestorOfClass("Model")
		end
		if model and not seen[model] then
			seen[model] = true
			local rec = records[model]
			if rec and not rec.Dead then
				table.insert(list, model)
			end
		end
	end
	return list
end

function EnemyService.GetRecord(model)
	return records[model]
end

---------------------------------------------------------------------------
-- 피격
---------------------------------------------------------------------------
-- opts: {From=Vector3, Knockback, Stun, Burn={Damage,Ticks}, Pull, Color}
function EnemyService.Damage(model, amount, player, opts)
	local rec = records[model]
	if not rec or rec.Dead then
		return
	end
	opts = opts or {}
	amount = math.max(1, math.floor(amount * (0.9 + math.random() * 0.2)))
	rec.LastHitBy = player
	if player then
		rec.Target = player
	end
	rec.Humanoid.Health = math.max(0, rec.Humanoid.Health - amount)
	Effects.DamageNumber(rec.Root, amount, opts.Color)

	if rec.Humanoid.Health <= 0 then
		return
	end

	local from = opts.From
	if from and (opts.Knockback or opts.Pull) then
		local diff = rec.Root.Position - from
		local flat = Vector3.new(diff.X, 0, diff.Z)
		local dir = flat.Magnitude > 0.1 and flat.Unit or rec.Root.CFrame.LookVector * -1
		local scale = rec.Def.Boss and 0.25 or 1
		if opts.Knockback then
			rec.Root.AssemblyLinearVelocity = (dir * opts.Knockback + Vector3.new(0, opts.Knockback * 0.35, 0)) * scale
		elseif opts.Pull then
			rec.Root.AssemblyLinearVelocity = -dir * math.min(opts.Pull, flat.Magnitude * 4) * scale
		end
	end
	if opts.Stun then
		local dur = rec.Def.Boss and opts.Stun * 0.4 or opts.Stun
		rec.StunUntil = math.max(rec.StunUntil, os.clock() + dur)
	end
	if opts.Burn then
		local burn = opts.Burn
		task.spawn(function()
			for _ = 1, burn.Ticks do
				task.wait(0.5)
				if rec.Dead or not model.Parent then
					return
				end
				EnemyService.Damage(model, burn.Damage * (opts.BurnScale or 1), player, { Color = Color3.fromRGB(255, 140, 40) })
			end
		end)
	end
end

---------------------------------------------------------------------------
-- 생성 / 사망
---------------------------------------------------------------------------
local spawnEnemy

local function onDied(rec)
	if rec.Dead then
		return
	end
	rec.Dead = true
	local model = rec.Model
	records[model] = nil
	if rec.WalkTrack then
		rec.WalkTrack:Stop()
	end

	local killer = rec.LastHitBy
	if killer and killer.Parent and EnemyService.OnKilled then
		task.spawn(EnemyService.OnKilled, killer, rec.Def)
	end

	Effects.Sphere(rec.Root.Position, 6, Color3.fromRGB(255, 255, 255), 0.5)
	task.delay(2, function()
		model:Destroy()
	end)
	task.delay(rec.Def.RespawnTime, function()
		spawnEnemy(rec.Def, rec.SpawnPos)
	end)
end

function spawnEnemy(def, spawnPos)
	local model = Rig.Create("Enemy_" .. def.Id, def)
	local hum = model:FindFirstChildOfClass("Humanoid")
	local root = model:FindFirstChild("HumanoidRootPart")
	hum.MaxHealth = def.Health
	hum.Health = def.Health
	hum.WalkSpeed = def.WalkSpeed
	model:PivotTo(CFrame.new(spawnPos + Vector3.new(0, Rig.RootHeight(model) + 1, 0)) * CFrame.Angles(0, math.random() * 6.28, 0))
	model:SetAttribute("EnemyId", def.Id)

	local plateColor = def.Boss and Color3.fromRGB(255, 80, 80) or Color3.fromRGB(255, 255, 255)
	local plate = Rig.Nameplate(model, string.format("[Lv.%d] %s", def.Level, def.Name), plateColor, true)
	local fill = plate.HealthBack.Fill

	local rec = {
		Model = model,
		Humanoid = hum,
		Root = root,
		Def = def,
		SpawnPos = spawnPos,
		StunUntil = 0,
		LastAttack = 0,
		Target = nil,
		LastHitBy = nil,
		Dead = false,
	}
	records[model] = rec

	hum.HealthChanged:Connect(function(hp)
		fill.Size = UDim2.fromScale(math.clamp(hp / hum.MaxHealth, 0, 1), 1)
	end)
	hum.Died:Connect(function()
		onDied(rec)
	end)

	model.Parent = folder
	pcall(function()
		root:SetNetworkOwner(nil)
	end)

	-- R15일 때만 기본 걷기/대기 애니메이션
	if hum.RigType == Enum.HumanoidRigType.R15 then
		pcall(function()
			local animator = hum:FindFirstChildOfClass("Animator") or Instance.new("Animator", hum)
			local walk = Instance.new("Animation")
			walk.AnimationId = WALK_ANIM
			local idle = Instance.new("Animation")
			idle.AnimationId = IDLE_ANIM
			rec.WalkTrack = animator:LoadAnimation(walk)
			rec.IdleTrack = animator:LoadAnimation(idle)
			rec.IdleTrack.Looped = true
			rec.WalkTrack.Looped = true
			rec.IdleTrack:Play()
		end)
	end
	return model
end

---------------------------------------------------------------------------
-- AI
---------------------------------------------------------------------------
local function aliveRoot(player)
	local char = player and player.Character
	if not char then
		return nil
	end
	local hum = char:FindFirstChildOfClass("Humanoid")
	local root = char:FindFirstChild("HumanoidRootPart")
	if hum and root and hum.Health > 0 then
		return root, hum
	end
	return nil
end

local function attack(rec, targetRoot, targetHum)
	rec.LastAttack = os.clock()
	local pos = rec.Root.Position
	rec.Root.CFrame = CFrame.lookAt(pos, Vector3.new(targetRoot.Position.X, pos.Y, targetRoot.Position.Z))
	local scale = rec.Def.Scale or 1
	Effects.Slash(rec.Root.CFrame * CFrame.new(0, 0, -2.5 * scale), 6 * scale, rec.Def.Boss and Color3.fromRGB(255, 80, 80) or Color3.fromRGB(255, 255, 255))
	targetHum:TakeDamage(rec.Def.Damage)
	if rec.Def.Boss then
		-- 보스는 주변 범위 공격도 함
		for _, player in Players:GetPlayers() do
			local r, h = aliveRoot(player)
			if r and h ~= targetHum and (r.Position - pos).Magnitude < 10 * scale then
				h:TakeDamage(rec.Def.Damage * 0.5)
			end
		end
	end
end

local function updateAnim(rec)
	if not rec.WalkTrack then
		return
	end
	local v = rec.Root.AssemblyLinearVelocity
	local moving = Vector3.new(v.X, 0, v.Z).Magnitude > 2
	if moving and not rec.WalkTrack.IsPlaying then
		rec.WalkTrack:Play()
	elseif not moving and rec.WalkTrack.IsPlaying then
		rec.WalkTrack:Stop()
	end
end

local function update(rec, now)
	local def = rec.Def
	local hum, root = rec.Humanoid, rec.Root
	updateAnim(rec)

	if now < rec.StunUntil then
		hum.WalkSpeed = 0
		return
	end
	hum.WalkSpeed = def.WalkSpeed

	local pos = root.Position
	local fromSpawn = (pos - rec.SpawnPos).Magnitude

	-- 타겟 유지/해제
	local tRoot, tHum = aliveRoot(rec.Target)
	if tRoot and ((tRoot.Position - rec.SpawnPos).Magnitude > def.LeashRange or fromSpawn > def.LeashRange * 1.3) then
		tRoot = nil
	end
	if not tRoot then
		rec.Target = nil
		local best, bestDist = nil, def.AggroRange
		for _, player in Players:GetPlayers() do
			local r = aliveRoot(player)
			if r then
				local d = (r.Position - pos).Magnitude
				if d < bestDist and (r.Position - rec.SpawnPos).Magnitude < def.LeashRange then
					best, bestDist = player, d
				end
			end
		end
		rec.Target = best
		tRoot, tHum = aliveRoot(best)
	end

	if tRoot then
		local dist = (tRoot.Position - pos).Magnitude
		if dist > def.AttackRange then
			hum:MoveTo(tRoot.Position)
		else
			hum:MoveTo(pos)
			if now - rec.LastAttack >= def.AttackCooldown then
				attack(rec, tRoot, tHum)
			end
		end
	else
		-- 체력 천천히 회복하며 귀환
		if hum.Health < hum.MaxHealth then
			hum.Health = math.min(hum.MaxHealth, hum.Health + hum.MaxHealth * 0.02)
		end
		if fromSpawn > 6 then
			hum:MoveTo(rec.SpawnPos)
		elseif math.random() < 0.02 then
			hum:MoveTo(rec.SpawnPos + Vector3.new(math.random(-10, 10), 0, math.random(-10, 10)))
		end
	end

	-- 바다에 빠지거나 맵 밖으로 나가면 복귀
	if pos.Y < -20 then
		root.CFrame = CFrame.new(rec.SpawnPos + Vector3.new(0, 5, 0))
	end
end

function EnemyService.Init(spawns)
	for _, s in spawns do
		local def = Config.Enemies[s.EnemyId]
		if def then
			spawnEnemy(def, s.Position)
		end
	end
	task.spawn(function()
		while true do
			task.wait(0.15)
			local now = os.clock()
			for _, rec in records do
				if not rec.Dead then
					local ok, err = pcall(update, rec, now)
					if not ok then
						warn("[EnemyService]", err)
					end
				end
			end
		end
	end)
end

return EnemyService
