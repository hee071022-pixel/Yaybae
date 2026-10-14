-- 서버에서 생성하는 시각 효과 (자동으로 모든 클라이언트에 보임)

local TweenService = game:GetService("TweenService")
local Debris = game:GetService("Debris")

local Effects = {}

local folder = Instance.new("Folder")
folder.Name = "Effects"
folder.Parent = workspace
Effects.Folder = folder

local function part(props)
	local p = Instance.new("Part")
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.CastShadow = false
	p.Material = Enum.Material.Neon
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	for k, v in props do
		p[k] = v
	end
	p.Parent = folder
	return p
end
Effects.Part = part

local function tween(inst, duration, goal, style)
	local t = TweenService:Create(inst, TweenInfo.new(duration, style or Enum.EasingStyle.Quad, Enum.EasingDirection.Out), goal)
	t:Play()
	return t
end

-- 퍼지는 구
function Effects.Sphere(pos, radius, color, duration)
	duration = duration or 0.4
	local p = part({ Shape = Enum.PartType.Ball, Size = Vector3.one, Color = color, Transparency = 0.15, CFrame = CFrame.new(pos) })
	tween(p, duration, { Size = Vector3.one * radius * 2, Transparency = 1 })
	Debris:AddItem(p, duration + 0.1)
end

-- 바닥에 퍼지는 고리
function Effects.Ring(pos, radius, color, duration)
	duration = duration or 0.5
	local cf = CFrame.new(pos) * CFrame.Angles(0, 0, math.rad(90))
	local p = part({ Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.4, 2, 2), Color = color, Transparency = 0.2, CFrame = cf })
	tween(p, duration, { Size = Vector3.new(0.4, radius * 2, radius * 2), Transparency = 1 })
	Debris:AddItem(p, duration + 0.1)
end

-- 직선 광선
function Effects.Beam(from, to, width, color, duration)
	duration = duration or 0.35
	local dist = (to - from).Magnitude
	if dist < 0.1 then
		return
	end
	local p = part({ Size = Vector3.new(width, width, dist), CFrame = CFrame.lookAt((from + to) / 2, to), Color = color, Transparency = 0.05 })
	tween(p, duration, { Size = Vector3.new(0, 0, dist), Transparency = 1 })
	Debris:AddItem(p, duration + 0.1)
end

-- 베기 궤적 (얇고 넓은 판)
function Effects.Slash(cf, width, color, duration)
	duration = duration or 0.25
	local tilt = math.rad(math.random(-40, 40))
	local p = part({ Size = Vector3.new(width, 0.2, width * 0.35), CFrame = cf * CFrame.Angles(0, 0, tilt), Color = color, Transparency = 0.1 })
	tween(p, duration, { Size = Vector3.new(width * 1.3, 0.05, width * 0.1), Transparency = 1 })
	Debris:AddItem(p, duration + 0.1)
end

-- 이동형 투사체 파트 (호출자가 CFrame을 갱신하고 제거)
function Effects.Projectile(pos, size, color)
	local p = part({ Shape = Enum.PartType.Ball, Size = Vector3.one * size, Color = color, CFrame = CFrame.new(pos) })
	local light = Instance.new("PointLight")
	light.Color = color
	light.Range = size * 4
	light.Brightness = 2
	light.Parent = p
	return p
end

function Effects.Fade(p, duration)
	tween(p, duration, { Transparency = 1, Size = p.Size * 1.5 })
	Debris:AddItem(p, duration + 0.1)
end

-- 떠오르는 데미지 숫자
function Effects.DamageNumber(adornee, amount, color)
	local bb = Instance.new("BillboardGui")
	bb.Size = UDim2.fromOffset(120, 40)
	bb.StudsOffset = Vector3.new((math.random() - 0.5) * 3, 2.5, 0)
	bb.AlwaysOnTop = true
	bb.MaxDistance = 150
	bb.Adornee = adornee
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Size = UDim2.fromScale(1, 1)
	label.Font = Enum.Font.GothamBlack
	label.TextScaled = true
	label.Text = tostring(amount)
	label.TextColor3 = color or Color3.fromRGB(255, 230, 80)
	label.TextStrokeTransparency = 0.2
	label.Parent = bb
	bb.Parent = adornee
	tween(bb, 0.8, { StudsOffset = bb.StudsOffset + Vector3.new(0, 3, 0) })
	tween(label, 0.8, { TextTransparency = 1, TextStrokeTransparency = 1 }, Enum.EasingStyle.Quint)
	Debris:AddItem(bb, 0.85)
end

-- 레벨업 효과
function Effects.LevelUp(root)
	local pos = root.Position - Vector3.new(0, 2.5, 0)
	Effects.Ring(pos, 12, Color3.fromRGB(255, 220, 60), 0.8)
	Effects.Beam(pos, pos + Vector3.new(0, 30, 0), 4, Color3.fromRGB(255, 240, 120), 0.8)
end

return Effects
