-- NPC/적 캐릭터 모델 생성 (R15 기본 아바타, 실패 시 블록 리그)

local Players = game:GetService("Players")

local Rig = {}

local cache = {}

local function blockRig(opts)
	local model = Instance.new("Model")
	local function block(name, size, color)
		local p = Instance.new("Part")
		p.Name = name
		p.Size = size
		p.Color = color
		p.TopSurface = Enum.SurfaceType.Smooth
		p.BottomSurface = Enum.SurfaceType.Smooth
		p.Parent = model
		return p
	end
	local root = block("HumanoidRootPart", Vector3.new(2, 2, 1), opts.Shirt)
	root.Transparency = 1
	local parts = {
		[block("Torso", Vector3.new(2, 2, 1), opts.Shirt)] = CFrame.new(),
		[block("Head", Vector3.new(2, 1, 1), opts.Skin)] = CFrame.new(0, 1.5, 0),
		[block("Left Arm", Vector3.new(1, 2, 1), opts.Skin)] = CFrame.new(-1.5, 0, 0),
		[block("Right Arm", Vector3.new(1, 2, 1), opts.Skin)] = CFrame.new(1.5, 0, 0),
		[block("Left Leg", Vector3.new(1, 2, 1), opts.Pants)] = CFrame.new(-0.5, -2, 0),
		[block("Right Leg", Vector3.new(1, 2, 1), opts.Pants)] = CFrame.new(0.5, -2, 0),
	}
	for p, offset in parts do
		p.CFrame = root.CFrame * offset
		local weld = Instance.new("Weld")
		weld.Part0 = root
		weld.Part1 = p
		weld.C0 = offset
		weld.Parent = p
	end
	local hum = Instance.new("Humanoid")
	hum.RigType = Enum.HumanoidRigType.R6
	hum.RequiresNeck = false
	hum.Parent = model
	model.PrimaryPart = root
	return model
end

local function r15Rig(opts)
	local desc = Instance.new("HumanoidDescription")
	desc.HeadColor = opts.Skin
	desc.LeftArmColor = opts.Skin
	desc.RightArmColor = opts.Skin
	desc.TorsoColor = opts.Shirt
	desc.LeftLegColor = opts.Pants
	desc.RightLegColor = opts.Pants
	return Players:CreateHumanoidModelFromDescription(desc, Enum.HumanoidRigType.R15)
end

-- key: 캐시 키, opts: {Skin, Shirt, Pants, Scale}
function Rig.Create(key, opts)
	if not cache[key] then
		local ok, model = pcall(r15Rig, opts)
		if not ok or not model then
			warn("[Rig] R15 생성 실패, 블록 리그 사용:", model)
			model = blockRig(opts)
		end
		if opts.Scale and opts.Scale ~= 1 then
			pcall(function()
				model:ScaleTo(opts.Scale)
			end)
		end
		local hum = model:FindFirstChildOfClass("Humanoid")
		hum.DisplayDistanceType = Enum.HumanoidDisplayDistanceType.None
		hum.HealthDisplayType = Enum.HumanoidHealthDisplayType.AlwaysOff
		-- 기본 Animate 스크립트 등은 제거 (서버에서 직접 애니메이션)
		for _, child in model:GetChildren() do
			if child:IsA("Script") or child:IsA("LocalScript") then
				child:Destroy()
			end
		end
		model.Name = key
		cache[key] = model
	end
	return cache[key]:Clone()
end

-- 발이 groundPos에 닿도록 배치할 때의 루트 높이
function Rig.RootHeight(model)
	local hum = model:FindFirstChildOfClass("Humanoid")
	local root = model:FindFirstChild("HumanoidRootPart")
	if hum.RigType == Enum.HumanoidRigType.R6 then
		return 3
	end
	return hum.HipHeight + root.Size.Y / 2
end

-- 머리 위 이름표 (+선택적 체력바)
function Rig.Nameplate(model, text, color, withHealth)
	local head = model:FindFirstChild("Head") or model.PrimaryPart
	local bb = Instance.new("BillboardGui")
	bb.Name = "Nameplate"
	bb.Size = UDim2.fromOffset(200, withHealth and 46 or 30)
	bb.StudsOffset = Vector3.new(0, 2.6, 0)
	bb.MaxDistance = 120
	bb.AlwaysOnTop = false
	bb.Adornee = head

	local label = Instance.new("TextLabel")
	label.Name = "Title"
	label.BackgroundTransparency = 1
	label.Size = UDim2.new(1, 0, 0, 26)
	label.Font = Enum.Font.GothamBold
	label.TextScaled = true
	label.Text = text
	label.TextColor3 = color or Color3.new(1, 1, 1)
	label.TextStrokeTransparency = 0.3
	label.Parent = bb

	if withHealth then
		local back = Instance.new("Frame")
		back.Name = "HealthBack"
		back.Position = UDim2.new(0.1, 0, 0, 30)
		back.Size = UDim2.new(0.8, 0, 0, 10)
		back.BackgroundColor3 = Color3.fromRGB(30, 30, 30)
		back.BorderSizePixel = 0
		back.Parent = bb
		local fill = Instance.new("Frame")
		fill.Name = "Fill"
		fill.Size = UDim2.fromScale(1, 1)
		fill.BackgroundColor3 = Color3.fromRGB(80, 220, 90)
		fill.BorderSizePixel = 0
		fill.Parent = back
		local corner = Instance.new("UICorner")
		corner.CornerRadius = UDim.new(0, 4)
		corner.Parent = back
		corner:Clone().Parent = fill
	end

	bb.Parent = head
	return bb
end

return Rig
