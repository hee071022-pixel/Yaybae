// 크리스탈 링크: 5초마다 접속한 플레이어 위치를 크리스탈 길드 운영실로 보낸다.
// 데디케이티드 서버(BDS)에서만 동작 (@minecraft/server-net). 키는 게임 안에서 관리자가 한 번 넣는다:
//   /scriptevent crystal:key ck_xxxxx        연동 키 넣기 (운영실 > 마인크래프트에서 복사)
//   /scriptevent crystal:url https://...     사이트 주소 바꾸기 (기본 crystal1234.netlify.app)
//   /scriptevent crystal:status              지금 상태 보기
import { world, system } from "@minecraft/server";
import { http, HttpRequest, HttpHeader, HttpRequestMethod } from "@minecraft/server-net";

const DEFAULT_URL = "https://crystal1234.netlify.app";
const EVERY_TICKS = 100; // 5초
const KEY_PROP = "crystal:key";
const URL_PROP = "crystal:url";

let busy = false;
let fails = 0;
let skip = 0;
let lastOk = 0;
let lastError = "";

const getKey = () => String(world.getDynamicProperty(KEY_PROP) ?? "");
const getUrl = () => String(world.getDynamicProperty(URL_PROP) ?? DEFAULT_URL).replace(/\/+$/, "");

function playerInfo(p) {
	const loc = p.location;
	let hp = null, maxHp = null, mode = null;
	try {
		const h = p.getComponent("minecraft:health");
		if (h) { hp = Math.round(h.currentValue * 10) / 10; maxHp = h.effectiveMax; }
	} catch { /* 없음 */ }
	try { mode = String(p.getGameMode()); } catch { /* 없음 */ }
	return {
		name: p.name,
		x: Math.round(loc.x * 10) / 10,
		y: Math.round(loc.y * 10) / 10,
		z: Math.round(loc.z * 10) / 10,
		dim: p.dimension.id,
		hp, maxHp, mode,
		level: p.level,
		tags: p.getTags().slice(0, 8),
	};
}

function send() {
	const key = getKey();
	if (!key || busy) return;
	// 연속으로 실패하면 잠깐 쉬었다가 다시 (최대 1분)
	if (skip > 0) { skip--; return; }
	const players = world.getAllPlayers().map(playerInfo);
	const req = new HttpRequest(`${getUrl()}/api/mc/positions`);
	req.method = HttpRequestMethod.Post;
	req.headers = [new HttpHeader("Content-Type", "application/json"), new HttpHeader("x-crystal-key", key)];
	req.body = JSON.stringify({ players });
	req.timeout = 10;
	busy = true;
	http.request(req).then((res) => {
		busy = false;
		if (res.status === 200) { fails = 0; lastOk = Date.now(); lastError = ""; return; }
		fails++;
		lastError = `HTTP ${res.status}${res.status === 401 ? " (키가 맞지 않아요)" : ""}`;
		skip = Math.min(12, fails);
		if (fails === 1 || fails % 20 === 0) console.warn(`[크리스탈 링크] 보내기 실패: ${lastError}`);
	}).catch((err) => {
		busy = false;
		fails++;
		lastError = String(err);
		skip = Math.min(12, fails);
		if (fails === 1 || fails % 20 === 0) console.warn(`[크리스탈 링크] 연결 실패: ${lastError}`);
	});
}

function reply(source, text) {
	if (source && typeof source.sendMessage === "function") source.sendMessage(text);
	else console.warn(text.replace(/§./g, ""));
}

system.afterEvents.scriptEventReceive.subscribe((ev) => {
	const src = ev.sourceEntity;
	const msg = ev.message.trim();
	if (ev.id === "crystal:key") {
		if (!/^ck_[A-Za-z0-9_-]{10,60}$/.test(msg)) return reply(src, "§c[크리스탈 링크] 키 모양이 이상해요. 운영실에서 복사한 ck_ 로 시작하는 키를 넣어 주세요.");
		world.setDynamicProperty(KEY_PROP, msg);
		fails = 0; skip = 0;
		reply(src, "§a[크리스탈 링크] 키를 저장했어요. 5초 안에 운영실에 위치가 보이기 시작해요.");
	} else if (ev.id === "crystal:url") {
		if (!/^https:\/\/[^\s]+$/.test(msg)) return reply(src, "§c[크리스탈 링크] https:// 로 시작하는 주소를 넣어 주세요.");
		world.setDynamicProperty(URL_PROP, msg);
		reply(src, `§a[크리스탈 링크] 주소를 ${msg} 로 바꿨어요.`);
	} else if (ev.id === "crystal:status") {
		const ago = lastOk ? `${Math.round((Date.now() - lastOk) / 1000)}초 전` : "아직 없음";
		reply(src, `§e[크리스탈 링크] 주소 ${getUrl()} · 키 ${getKey() ? "있음" : "§c없음§e"} · 마지막 성공 ${ago}${lastError ? ` · 오류 ${lastError}` : ""}`);
	}
});

system.runInterval(send, EVERY_TICKS);
console.warn("[크리스탈 링크] 로드됨 - /scriptevent crystal:status");
