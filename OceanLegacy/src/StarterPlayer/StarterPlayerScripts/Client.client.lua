-- 오션 레거시 클라이언트: UI, 입력(공격/스킬/대시/이단점프), 상점 창

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local UserInputService = game:GetService("UserInputService")
local TweenService = game:GetService("TweenService")
local RunService = game:GetService("RunService")
local Debris = game:GetService("Debris")

local player = Players.LocalPlayer
local mouse = player:GetMouse()
local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local Remotes = ReplicatedStorage:WaitForChild("Remotes")

local data = nil
local cooldowns = {}

local C = Color3.fromRGB
local Theme = {
	Panel = C(20, 26, 40),
	Panel2 = C(35, 44, 66),
	Accent = C(255, 200, 60),
	Text = C(240, 240, 245),
	Sub = C(170, 180, 200),
	HP = C(80, 220, 100),
	XP = C(80, 190, 255),
	Red = C(230, 80, 80),
}

---------------------------------------------------------------------------
-- UI 헬퍼
---------------------------------------------------------------------------
local function make(class, props, children)
	local inst = Instance.new(class)
	for k, v in props or {} do
		if k ~= "Parent" then
			inst[k] = v
		end
	end
	for _, child in children or {} do
		child.Parent = inst
	end
	if props and props.Parent then
		inst.Parent = props.Parent
	end
	return inst
end

local function corner(r)
	return make("UICorner", { CornerRadius = UDim.new(0, r or 8) })
end

local function stroke(color, thickness)
	return make("UIStroke", { Color = color or C(0, 0, 0), Thickness = thickness or 1.5, Transparency = 0.3 })
end

local function label(props)
	local t = {
		BackgroundTransparency = 1,
		Font = Enum.Font.GothamBold,
		TextColor3 = Theme.Text,
		TextScaled = true,
		Text = "",
	}
	for k, v in props do
		if k ~= "MaxSize" then
			t[k] = v
		end
	end
	return make("TextLabel", t, { make("UITextSizeConstraint", { MaxTextSize = props.MaxSize or 20 }) })
end

local function button(props)
	local t = {
		BackgroundColor3 = Theme.Panel2,
		Font = Enum.Font.GothamBold,
		TextColor3 = Theme.Text,
		TextScaled = true,
		AutoButtonColor = true,
	}
	for k, v in props do
		if k ~= "MaxSize" then
			t[k] = v
		end
	end
	return make("TextButton", t, { corner(6), make("UITextSizeConstraint", { MaxTextSize = props.MaxSize or 18 }) })
end

local function formatNumber(n)
	local s = tostring(math.floor(n))
	local formatted = s:reverse():gsub("(%d%d%d)", "%1,"):reverse()
	return (formatted:gsub("^,", ""))
end

local gui = make("ScreenGui", {
	Name = "OceanHUD",
	ResetOnSpawn = false,
	ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
	Parent = player:WaitForChild("PlayerGui"),
})

---------------------------------------------------------------------------
-- 알림
---------------------------------------------------------------------------
local notifyList = make("Frame", {
	BackgroundTransparency = 1,
	AnchorPoint = Vector2.new(0.5, 0),
	Position = UDim2.new(0.5, 0, 0, 70),
	Size = UDim2.fromOffset(520, 300),
	Parent = gui,
}, {
	make("UIListLayout", { HorizontalAlignment = Enum.HorizontalAlignment.Center, Padding = UDim.new(0, 4), SortOrder = Enum.SortOrder.LayoutOrder }),
})

local notifyCount = 0
local function notify(text, color)
	notifyCount += 1
	local item = label({
		Size = UDim2.fromOffset(520, 30),
		Text = text,
		TextColor3 = color or Theme.Text,
		TextStrokeTransparency = 0.2,
		LayoutOrder = notifyCount,
		MaxSize = 22,
		Parent = notifyList,
	})
	task.delay(3.5, function()
		TweenService:Create(item, TweenInfo.new(0.5), { TextTransparency = 1, TextStrokeTransparency = 1 }):Play()
		Debris:AddItem(item, 0.6)
	end)
	local items = {}
	for _, child in notifyList:GetChildren() do
		if child:IsA("TextLabel") then
			table.insert(items, child)
		end
	end
	if #items > 6 then
		table.sort(items, function(a, b)
			return a.LayoutOrder < b.LayoutOrder
		end)
		items[1]:Destroy()
	end
end
Remotes.Notify.OnClientEvent:Connect(notify)

---------------------------------------------------------------------------
-- 하단 HUD (레벨, 체력, 경험치)
---------------------------------------------------------------------------
local hud = make("Frame", {
	AnchorPoint = Vector2.new(0.5, 1),
	Position = UDim2.new(0.5, 0, 1, -80),
	Size = UDim2.fromOffset(460, 64),
	BackgroundColor3 = Theme.Panel,
	BackgroundTransparency = 0.15,
	Parent = gui,
}, { corner(10), stroke() })

local levelLabel = label({
	Position = UDim2.fromOffset(8, 8),
	Size = UDim2.fromOffset(80, 48),
	Text = "Lv.1",
	TextColor3 = Theme.Accent,
	MaxSize = 26,
	Font = Enum.Font.GothamBlack,
	Parent = hud,
})

local function bar(y, color)
	local back = make(
		"Frame",
		{ Position = UDim2.fromOffset(96, y), Size = UDim2.new(1, -106, 0, 22), BackgroundColor3 = C(10, 12, 20), Parent = hud },
		{ corner(6) }
	)
	local fill = make("Frame", { Size = UDim2.fromScale(1, 1), BackgroundColor3 = color, Parent = back }, { corner(6) })
	local text = label({ Size = UDim2.fromScale(1, 1), ZIndex = 2, TextStrokeTransparency = 0.4, MaxSize = 15, Parent = back })
	return fill, text
end
local hpFill, hpText = bar(8, Theme.HP)
local xpFill, xpText = bar(34, Theme.XP)

local beliLabel = label({
	AnchorPoint = Vector2.new(1, 0),
	Position = UDim2.new(1, -16, 0, 8),
	Size = UDim2.fromOffset(240, 34),
	Text = "벨리: 0",
	TextColor3 = C(255, 215, 80),
	TextXAlignment = Enum.TextXAlignment.Right,
	TextStrokeTransparency = 0.3,
	MaxSize = 24,
	Parent = gui,
})

---------------------------------------------------------------------------
-- 퀘스트 패널
---------------------------------------------------------------------------
local questPanel = make("Frame", {
	Position = UDim2.new(0, 16, 0.3, 0),
	Size = UDim2.fromOffset(270, 84),
	BackgroundColor3 = Theme.Panel,
	BackgroundTransparency = 0.2,
	Parent = gui,
}, { corner(10), stroke() })
label({
	Position = UDim2.fromOffset(12, 6),
	Size = UDim2.new(1, -24, 0, 22),
	Text = "퀘스트",
	TextColor3 = Theme.Accent,
	TextXAlignment = Enum.TextXAlignment.Left,
	Parent = questPanel,
})
local questBody = label({
	Position = UDim2.fromOffset(12, 30),
	Size = UDim2.new(1, -24, 0, 46),
	Text = "",
	Font = Enum.Font.Gotham,
	TextXAlignment = Enum.TextXAlignment.Left,
	TextYAlignment = Enum.TextYAlignment.Top,
	TextWrapped = true,
	MaxSize = 15,
	Parent = questPanel,
})

local statButton = button({
	Position = UDim2.new(0, 16, 0.3, 94),
	Size = UDim2.fromOffset(130, 36),
	Text = "스탯 [M]",
	BackgroundColor3 = Theme.Panel,
	Parent = gui,
})
local statBadge = make("Frame", {
	AnchorPoint = Vector2.new(0.5, 0.5),
	Position = UDim2.new(1, -4, 0, 4),
	Size = UDim2.fromOffset(14, 14),
	BackgroundColor3 = Theme.Red,
	Visible = false,
	Parent = statButton,
}, { corner(7) })

label({
	Position = UDim2.new(0, 16, 0.3, 138),
	Size = UDim2.fromOffset(270, 60),
	Text = "클릭: 공격 · Z/X/C/V: 스킬\nQ: 대시 · 공중 Space: 이단 점프",
	Font = Enum.Font.Gotham,
	TextColor3 = Theme.Sub,
	TextXAlignment = Enum.TextXAlignment.Left,
	TextYAlignment = Enum.TextYAlignment.Top,
	TextStrokeTransparency = 0.6,
	MaxSize = 14,
	Parent = gui,
})

---------------------------------------------------------------------------
-- 스탯 창
---------------------------------------------------------------------------
local statWindow = make("Frame", {
	AnchorPoint = Vector2.new(0.5, 0.5),
	Position = UDim2.fromScale(0.5, 0.5),
	Size = UDim2.fromOffset(380, 300),
	BackgroundColor3 = Theme.Panel,
	Visible = false,
	Parent = gui,
}, { corner(12), stroke(Theme.Accent, 2) })
label({
	Position = UDim2.fromOffset(16, 10),
	Size = UDim2.new(1, -60, 0, 30),
	Text = "스탯",
	TextColor3 = Theme.Accent,
	TextXAlignment = Enum.TextXAlignment.Left,
	MaxSize = 24,
	Parent = statWindow,
})
local pointsLabel = label({
	Position = UDim2.fromOffset(16, 44),
	Size = UDim2.new(1, -32, 0, 22),
	Text = "",
	TextColor3 = Theme.Sub,
	TextXAlignment = Enum.TextXAlignment.Left,
	MaxSize = 16,
	Parent = statWindow,
})
local closeStats = button({
	AnchorPoint = Vector2.new(1, 0),
	Position = UDim2.new(1, -10, 0, 10),
	Size = UDim2.fromOffset(32, 32),
	Text = "X",
	BackgroundColor3 = Theme.Red,
	Parent = statWindow,
})

local statRows = {}
local statDescriptions = {
	Melee = "주먹 데미지 증가",
	Defense = "최대 체력 증가",
	Sword = "검 데미지 증가",
	Fruit = "열매 스킬 데미지 증가",
}
for i, stat in Config.Stats do
	local row = make(
		"Frame",
		{ Position = UDim2.fromOffset(16, 74 + (i - 1) * 54), Size = UDim2.new(1, -32, 0, 46), BackgroundColor3 = Theme.Panel2, Parent = statWindow },
		{ corner(8) }
	)
	local value = label({
		Position = UDim2.fromOffset(10, 4),
		Size = UDim2.new(1, -150, 0, 22),
		Text = "",
		TextXAlignment = Enum.TextXAlignment.Left,
		MaxSize = 18,
		Parent = row,
	})
	label({
		Position = UDim2.fromOffset(10, 26),
		Size = UDim2.new(1, -150, 0, 16),
		Text = statDescriptions[stat],
		Font = Enum.Font.Gotham,
		TextColor3 = Theme.Sub,
		TextXAlignment = Enum.TextXAlignment.Left,
		MaxSize = 13,
		Parent = row,
	})
	for j, amount in { 1, 10, 100 } do
		local b = button({
			AnchorPoint = Vector2.new(1, 0.5),
			Position = UDim2.new(1, -8 - (3 - j) * 44, 0.5, 0),
			Size = UDim2.fromOffset(40, 32),
			Text = "+" .. amount,
			BackgroundColor3 = C(60, 140, 80),
			MaxSize = 14,
			Parent = row,
		})
		b.MouseButton1Click:Connect(function()
			if data and data.Points > 0 then
				Remotes.AddStat:FireServer(stat, math.min(amount, data.Points))
			end
		end)
	end
	statRows[stat] = value
end

local function toggleStats(force)
	if force ~= nil then
		statWindow.Visible = force
	else
		statWindow.Visible = not statWindow.Visible
	end
end
statButton.MouseButton1Click:Connect(function()
	toggleStats()
end)
closeStats.MouseButton1Click:Connect(function()
	toggleStats(false)
end)

---------------------------------------------------------------------------
-- 스킬 패널
---------------------------------------------------------------------------
local skillPanel = make("Frame", {
	AnchorPoint = Vector2.new(1, 1),
	Position = UDim2.new(1, -16, 1, -80),
	Size = UDim2.fromOffset(4 * 92, 74),
	BackgroundTransparency = 1,
	Parent = gui,
}, { make("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 6), HorizontalAlignment = Enum.HorizontalAlignment.Right }) })

local useSkill -- forward
local skillButtons = {}
for i, key in Config.SkillKeys do
	local b = button({ Size = UDim2.fromOffset(86, 74), Text = "", BackgroundColor3 = Theme.Panel, LayoutOrder = i, Parent = skillPanel })
	stroke().Parent = b
	local keyLabel = label({
		Position = UDim2.fromOffset(6, 4),
		Size = UDim2.fromOffset(24, 22),
		Text = key,
		TextColor3 = Theme.Accent,
		MaxSize = 20,
		Font = Enum.Font.GothamBlack,
		ZIndex = 3,
		Parent = b,
	})
	local nameLabel =
		label({ Position = UDim2.fromOffset(4, 28), Size = UDim2.new(1, -8, 0, 40), Text = "", TextWrapped = true, MaxSize = 14, ZIndex = 3, Parent = b })
	local overlay = make("Frame", {
		AnchorPoint = Vector2.new(0, 1),
		Position = UDim2.fromScale(0, 1),
		Size = UDim2.fromScale(1, 0),
		BackgroundColor3 = C(0, 0, 0),
		BackgroundTransparency = 0.4,
		ZIndex = 2,
		Parent = b,
	}, { corner(6) })
	local cdText = label({ Size = UDim2.fromScale(1, 1), Text = "", ZIndex = 4, MaxSize = 22, TextStrokeTransparency = 0.2, Parent = b })
	b.MouseButton1Click:Connect(function()
		useSkill(key)
	end)
	skillButtons[key] = { Button = b, Key = keyLabel, Name = nameLabel, Overlay = overlay, CD = cdText }
end

---------------------------------------------------------------------------
-- 상점 / 이동 창
---------------------------------------------------------------------------
local shopWindow = make("Frame", {
	AnchorPoint = Vector2.new(0.5, 0.5),
	Position = UDim2.fromScale(0.5, 0.5),
	Size = UDim2.fromOffset(440, 400),
	BackgroundColor3 = Theme.Panel,
	Visible = false,
	Parent = gui,
}, { corner(12), stroke(Theme.Accent, 2) })
local shopTitle = label({
	Position = UDim2.fromOffset(16, 10),
	Size = UDim2.new(1, -70, 0, 32),
	Text = "",
	TextColor3 = Theme.Accent,
	TextXAlignment = Enum.TextXAlignment.Left,
	MaxSize = 24,
	Parent = shopWindow,
})
local closeShop = button({
	AnchorPoint = Vector2.new(1, 0),
	Position = UDim2.new(1, -10, 0, 10),
	Size = UDim2.fromOffset(32, 32),
	Text = "X",
	BackgroundColor3 = Theme.Red,
	Parent = shopWindow,
})
local shopList = make("ScrollingFrame", {
	Position = UDim2.fromOffset(12, 52),
	Size = UDim2.new(1, -24, 1, -64),
	BackgroundTransparency = 1,
	BorderSizePixel = 0,
	ScrollBarThickness = 6,
	AutomaticCanvasSize = Enum.AutomaticSize.Y,
	CanvasSize = UDim2.new(),
	Parent = shopWindow,
}, { make("UIListLayout", { Padding = UDim.new(0, 6), SortOrder = Enum.SortOrder.LayoutOrder }) })
closeShop.MouseButton1Click:Connect(function()
	shopWindow.Visible = false
end)

local currentShop = nil

local function clearShop()
	for _, child in shopList:GetChildren() do
		if not child:IsA("UIListLayout") then
			child:Destroy()
		end
	end
end

local function shopRow(order, title, subtitle, titleColor, buttonText, buttonColor, onClick)
	local row = make("Frame", { Size = UDim2.new(1, -8, 0, 58), BackgroundColor3 = Theme.Panel2, LayoutOrder = order, Parent = shopList }, { corner(8) })
	label({
		Position = UDim2.fromOffset(12, 6),
		Size = UDim2.new(1, -140, 0, 24),
		Text = title,
		TextColor3 = titleColor or Theme.Text,
		TextXAlignment = Enum.TextXAlignment.Left,
		MaxSize = 18,
		Parent = row,
	})
	label({
		Position = UDim2.fromOffset(12, 32),
		Size = UDim2.new(1, -140, 0, 18),
		Text = subtitle,
		Font = Enum.Font.Gotham,
		TextColor3 = Theme.Sub,
		TextXAlignment = Enum.TextXAlignment.Left,
		MaxSize = 14,
		Parent = row,
	})
	if buttonText then
		local b = button({
			AnchorPoint = Vector2.new(1, 0.5),
			Position = UDim2.new(1, -10, 0.5, 0),
			Size = UDim2.fromOffset(110, 38),
			Text = buttonText,
			BackgroundColor3 = buttonColor or C(60, 140, 80),
			MaxSize = 15,
			Parent = row,
		})
		if onClick then
			b.MouseButton1Click:Connect(onClick)
		else
			b.AutoButtonColor = false
		end
	end
	return row
end

local function sortedKeys(tbl, by)
	local keys = {}
	for k in tbl do
		table.insert(keys, k)
	end
	table.sort(keys, function(a, b)
		return by(tbl[a]) < by(tbl[b])
	end)
	return keys
end

local renderShop = {}

function renderShop.Fruit()
	shopTitle.Text = "악마의 열매 뽑기"
	local current = data and data.Fruit and Config.Fruits[data.Fruit]
	shopRow(
		0,
		"랜덤 열매 뽑기",
		"가격: " .. formatNumber(Config.FruitPrice) .. " 벨리" .. (current and (" · 현재: " .. current.Name) or ""),
		Theme.Accent,
		"뽑기!",
		C(150, 60, 200),
		function()
			Remotes.BuyFruit:FireServer()
		end
	)
	local total = 0
	for _, f in Config.Fruits do
		total += Config.RarityWeights[f.Rarity]
	end
	local rarityOrder = { Common = 1, Rare = 2, Legendary = 3, Mythical = 4 }
	for i, id in
		sortedKeys(Config.Fruits, function(f)
			return rarityOrder[f.Rarity]
		end)
	do
		local f = Config.Fruits[id]
		local chance = Config.RarityWeights[f.Rarity] / total * 100
		local names = {}
		for _, key in Config.SkillKeys do
			if f.Skills[key] then
				table.insert(names, f.Skills[key].Name)
			end
		end
		shopRow(i, string.format("[%s] %s  (%.1f%%)", Config.RarityNames[f.Rarity], f.Name, chance), table.concat(names, " · "), Config.RarityColors[f.Rarity])
	end
end

function renderShop.Sword()
	shopTitle.Text = "대장장이 - 검 상점"
	for i, id in
		sortedKeys(Config.Swords, function(s)
			return s.Order
		end)
	do
		local s = Config.Swords[id]
		local owned = data and table.find(data.Swords, id)
		shopRow(
			i,
			s.Name,
			string.format("데미지 x%.2f · %s 벨리", s.Damage, formatNumber(s.Price)),
			s.Color,
			owned and "보유 중" or "구매",
			owned and C(80, 80, 90) or nil,
			(not owned) and function()
				Remotes.BuySword:FireServer(id)
			end or nil
		)
	end
end

function renderShop.Travel()
	shopTitle.Text = "항해사 - 섬 이동"
	for i, island in Config.Islands do
		local locked = data and data.Level < island.Level
		shopRow(
			i,
			island.Name,
			"권장 레벨 " .. island.Level .. "+",
			locked and Theme.Sub or Theme.Text,
			locked and "잠김" or "출항",
			locked and C(80, 80, 90) or C(50, 120, 200),
			(not locked) and function()
				Remotes.Travel:FireServer(island.Id)
				shopWindow.Visible = false
			end or nil
		)
	end
end

local function openShop(kind)
	currentShop = kind
	clearShop()
	renderShop[kind]()
	shopWindow.Visible = true
	statWindow.Visible = false
end

-- 열매 획득 연출
local function fruitReveal(id)
	local f = Config.Fruits[id]
	if not f then
		return
	end
	local banner = label({
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.35),
		Size = UDim2.fromOffset(600, 70),
		Text = f.Name .. "!",
		TextColor3 = Config.RarityColors[f.Rarity],
		Font = Enum.Font.GothamBlack,
		TextStrokeTransparency = 0,
		MaxSize = 60,
		Parent = gui,
	})
	banner.Size = UDim2.fromOffset(100, 12)
	TweenService:Create(banner, TweenInfo.new(0.4, Enum.EasingStyle.Back), { Size = UDim2.fromOffset(600, 70) }):Play()
	task.delay(2, function()
		TweenService:Create(banner, TweenInfo.new(0.5), { TextTransparency = 1, TextStrokeTransparency = 1 }):Play()
		Debris:AddItem(banner, 0.6)
	end)
end

Remotes.OpenShop.OnClientEvent:Connect(function(kind, extra)
	if kind == "FruitResult" then
		fruitReveal(extra)
		if currentShop == "Fruit" and shopWindow.Visible then
			task.defer(openShop, "Fruit")
		end
		return
	end
	if renderShop[kind] then
		openShop(kind)
	end
end)

---------------------------------------------------------------------------
-- 데이터 → UI 반영
---------------------------------------------------------------------------
local function equippedTool()
	local char = player.Character
	return char and char:FindFirstChildOfClass("Tool")
end

local function currentSet()
	local tool = equippedTool()
	if not tool then
		return nil
	end
	local kind, id = tool:GetAttribute("Kind"), tool:GetAttribute("ItemId")
	local set = Config.GetSkillSet(kind, id)
	return set, kind, id
end

local function cdKey(kind, id, key)
	return kind .. ":" .. tostring(id) .. ":" .. key
end

local function refreshSkills()
	local set, kind, id = currentSet()
	skillPanel.Visible = set ~= nil
	if not set then
		return
	end
	for _, key in Config.SkillKeys do
		local entry = skillButtons[key]
		local skill = set[key]
		entry.Button.Visible = skill ~= nil
		if skill then
			local locked = data and data.Level < (skill.Level or 1)
			entry.Name.Text = locked and ("Lv." .. skill.Level) or skill.Name
			entry.Name.TextColor3 = locked and Theme.Red or Theme.Text
			entry.CooldownKey = cdKey(kind, id, key)
			entry.Duration = skill.Cooldown
		end
	end
end

local function refreshData()
	if not data then
		return
	end
	levelLabel.Text = "Lv." .. data.Level
	local need = Config.XPForLevel(data.Level)
	if data.Level >= Config.MaxLevel then
		xpFill.Size = UDim2.fromScale(1, 1)
		xpText.Text = "MAX"
	else
		xpFill.Size = UDim2.fromScale(math.clamp(data.XP / need, 0, 1), 1)
		xpText.Text = string.format("EXP %s / %s", formatNumber(data.XP), formatNumber(need))
	end
	beliLabel.Text = "벨리: " .. formatNumber(data.Beli)

	local q = data.Quest and Config.Quests[data.Quest.Id]
	if q then
		local e = Config.Enemies[q.Target]
		questBody.Text =
			string.format("%s 처치 (%d/%d)\n보상: %s EXP · %s 벨리", e.Name, data.Quest.Progress, q.Amount, formatNumber(q.XP), formatNumber(q.Beli))
	else
		questBody.Text = "없음 — 섬 광장의 퀘스트 안내원에게\n말을 걸어보세요. (E)"
	end

	pointsLabel.Text = "남은 포인트: " .. data.Points
	statBadge.Visible = data.Points > 0
	for stat, value in statRows do
		value.Text = string.format("%s: %d", Config.StatNames[stat], data.Stats[stat])
	end
	refreshSkills()
	if shopWindow.Visible and currentShop and currentShop ~= "Fruit" then
		openShop(currentShop)
	end
end

Remotes.Data.OnClientEvent:Connect(function(newData)
	data = newData
	refreshData()
end)

---------------------------------------------------------------------------
-- 캐릭터 / 체력
---------------------------------------------------------------------------
local character, humanoid, rootPart
local doubleJumped = false
local lastJump = 0

local function updateHealth()
	if not humanoid then
		return
	end
	local max = math.max(1, humanoid.MaxHealth)
	hpFill.Size = UDim2.fromScale(math.clamp(humanoid.Health / max, 0, 1), 1)
	hpText.Text = string.format("HP %s / %s", formatNumber(math.max(0, humanoid.Health)), formatNumber(max))
end

local function onCharacter(char)
	character = char
	humanoid = char:WaitForChild("Humanoid")
	rootPart = char:WaitForChild("HumanoidRootPart")
	mouse.TargetFilter = char
	humanoid.HealthChanged:Connect(updateHealth)
	humanoid:GetPropertyChangedSignal("MaxHealth"):Connect(updateHealth)
	updateHealth()
	humanoid.StateChanged:Connect(function(_, new)
		if new == Enum.HumanoidStateType.Landed or new == Enum.HumanoidStateType.Running then
			doubleJumped = false
		elseif new == Enum.HumanoidStateType.Jumping then
			lastJump = os.clock()
		end
	end)
	char.ChildAdded:Connect(function(child)
		if child:IsA("Tool") then
			refreshSkills()
		end
	end)
	char.ChildRemoved:Connect(function(child)
		if child:IsA("Tool") then
			task.defer(refreshSkills)
		end
	end)
	refreshSkills()
end
player.CharacterAdded:Connect(onCharacter)
if player.Character then
	task.spawn(onCharacter, player.Character)
end

---------------------------------------------------------------------------
-- 전투 입력
---------------------------------------------------------------------------
local touchOnly = UserInputService.TouchEnabled and not UserInputService.MouseEnabled

local function aimPoint()
	if touchOnly and rootPart then
		local cam = workspace.CurrentCamera
		return rootPart.Position + cam.CFrame.LookVector * 60
	end
	return mouse.Hit.Position
end

local function faceTarget(target)
	if not rootPart or not humanoid or humanoid.Health <= 0 then
		return
	end
	local pos = rootPart.Position
	local flat = Vector3.new(target.X, pos.Y, target.Z)
	if (flat - pos).Magnitude > 1 then
		rootPart.CFrame = CFrame.lookAt(pos, flat)
	end
end

local nextM1 = 0
local holding = false

local function tryAttack()
	if not humanoid or humanoid.Health <= 0 or not currentSet() then
		return
	end
	local now = os.clock()
	if now < nextM1 then
		return
	end
	nextM1 = now + Config.M1Cooldown
	local target = aimPoint()
	faceTarget(target)
	Remotes.Attack:FireServer(target)
end

function useSkill(key)
	local set, kind, id = currentSet()
	if not set or not set[key] or not humanoid or humanoid.Health <= 0 then
		return
	end
	local skill = set[key]
	if data and data.Level < (skill.Level or 1) then
		notify(string.format("%s 스킬은 Lv.%d부터 사용할 수 있습니다.", skill.Name, skill.Level), Theme.Red)
		return
	end
	local k = cdKey(kind, id, key)
	local now = os.clock()
	if cooldowns[k] and now < cooldowns[k] then
		return
	end
	cooldowns[k] = now + skill.Cooldown
	local target = aimPoint()
	faceTarget(target)
	Remotes.Skill:FireServer(key, target)
end

-- 대시
local nextDash = 0
local function dash()
	if not rootPart or not humanoid or humanoid.Health <= 0 then
		return
	end
	local now = os.clock()
	if now < nextDash then
		return
	end
	nextDash = now + 1.2
	local dir = humanoid.MoveDirection.Magnitude > 0.1 and humanoid.MoveDirection or rootPart.CFrame.LookVector
	dir = Vector3.new(dir.X, 0, dir.Z).Unit
	local att = Instance.new("Attachment")
	att.Parent = rootPart
	local lv = Instance.new("LinearVelocity")
	lv.Attachment0 = att
	lv.MaxForce = math.huge
	lv.RelativeTo = Enum.ActuatorRelativeTo.World
	lv.VectorVelocity = dir * 95
	lv.Parent = rootPart
	Debris:AddItem(lv, 0.18)
	Debris:AddItem(att, 0.18)
end

-- 이단 점프
UserInputService.JumpRequest:Connect(function()
	if not humanoid or doubleJumped or humanoid.Health <= 0 then
		return
	end
	if humanoid:GetState() == Enum.HumanoidStateType.Freefall and os.clock() - lastJump > 0.25 then
		doubleJumped = true
		rootPart.AssemblyLinearVelocity = Vector3.new(rootPart.AssemblyLinearVelocity.X, 60, rootPart.AssemblyLinearVelocity.Z)
		humanoid:ChangeState(Enum.HumanoidStateType.Jumping)
	end
end)

local keyToSkill = { [Enum.KeyCode.Z] = "Z", [Enum.KeyCode.X] = "X", [Enum.KeyCode.C] = "C", [Enum.KeyCode.V] = "V" }

UserInputService.InputBegan:Connect(function(input, processed)
	if input.UserInputType == Enum.UserInputType.MouseButton1 then
		if not processed then
			holding = true
			tryAttack()
		end
		return
	end
	if processed then
		return
	end
	local skillKey = keyToSkill[input.KeyCode]
	if skillKey then
		useSkill(skillKey)
	elseif input.KeyCode == Enum.KeyCode.Q then
		dash()
	elseif input.KeyCode == Enum.KeyCode.M then
		toggleStats()
	end
end)

UserInputService.InputEnded:Connect(function(input)
	if input.UserInputType == Enum.UserInputType.MouseButton1 then
		holding = false
	end
end)

-- 모바일: 도구 탭 공격
local hooked = {}
local function hookTool(tool)
	if tool:IsA("Tool") and not hooked[tool] then
		hooked[tool] = true
		tool.Activated:Connect(tryAttack)
	end
end
local function hookBackpack(backpack)
	for _, t in backpack:GetChildren() do
		hookTool(t)
	end
	backpack.ChildAdded:Connect(hookTool)
end
player.ChildAdded:Connect(function(child)
	if child:IsA("Backpack") then
		hookBackpack(child)
	end
end)
if player:FindFirstChildOfClass("Backpack") then
	hookBackpack(player:FindFirstChildOfClass("Backpack"))
end

-- 모바일 대시 버튼
if UserInputService.TouchEnabled then
	local dashButton = button({
		AnchorPoint = Vector2.new(1, 1),
		Position = UDim2.new(1, -16, 1, -164),
		Size = UDim2.fromOffset(70, 50),
		Text = "대시",
		BackgroundColor3 = Theme.Panel,
		Parent = gui,
	})
	dashButton.MouseButton1Click:Connect(dash)
end

---------------------------------------------------------------------------
-- 매 프레임: 홀드 공격, 쿨다운 표시
---------------------------------------------------------------------------
RunService.RenderStepped:Connect(function()
	if holding then
		tryAttack()
	end
	local now = os.clock()
	for _, entry in skillButtons do
		local ready = entry.CooldownKey and cooldowns[entry.CooldownKey]
		if ready and now < ready then
			local left = ready - now
			entry.Overlay.Size = UDim2.fromScale(1, math.clamp(left / entry.Duration, 0, 1))
			entry.CD.Text = string.format("%.1f", left)
		else
			entry.Overlay.Size = UDim2.fromScale(1, 0)
			entry.CD.Text = ""
		end
	end
end)

skillPanel.Visible = false
Remotes.RequestData:FireServer()
