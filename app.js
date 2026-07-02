const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const els = {
  scoreboard: document.getElementById("scoreboard"),
  currentPlayerName: document.getElementById("currentPlayerName"),
  turnInfo: document.getElementById("turnInfo"),
  unitPanel: document.getElementById("unitPanel"),
  endTurnBtn: document.getElementById("endTurnBtn"),
  captureBtn: document.getElementById("captureBtn"),
  warpBtn: document.getElementById("warpBtn"),
  resetBtn: document.getElementById("resetBtn"),
  battleLog: document.getElementById("battleLog"),
  toast: document.getElementById("toast"),
  objectivePanel: document.getElementById("objectivePanel"),
  resultModal: document.getElementById("resultModal"),
  resultTitle: document.getElementById("resultTitle"),
  resultText: document.getElementById("resultText"),
  playAgainBtn: document.getElementById("playAgainBtn"),
};

const MAX_ROUNDS = 20;
const MAP_RADIUS = 6;
const HEX_SIZE = 42;
const SQRT3 = Math.sqrt(3);

const COLORS = {
  blue: "#45a7ff",
  red: "#ff5d69",
  green: "#67dd7a",
  gold: "#ffc857",
  neutral: "#6d7f91",
};

const PLAYERS = [
  { id: "blue", name: "苍穹议会", shortName: "蓝方", color: COLORS.blue, isHuman: true },
  { id: "red", name: "赤曜联邦", shortName: "红方", color: COLORS.red, isHuman: false },
  { id: "green", name: "翡翠同盟", shortName: "绿方", color: COLORS.green, isHuman: false },
  { id: "gold", name: "金辉商约", shortName: "黄方", color: COLORS.gold, isHuman: false },
];

const UNIT_TYPES = {
  interceptor: { name: "截击机", atk: 6, def: 3, maxHp: 3, vision: 2, move: 4, counter: "bomber" },
  bomber: { name: "轰炸艇", atk: 8, def: 2, maxHp: 3, vision: 2, move: 3, counter: "structure" },
  awacs: { name: "预警舰", atk: 2, def: 5, maxHp: 4, vision: 3, move: 3, counter: null },
};

const AUDIO_PATTERNS = {
  select: [
    [520, 0.035, "sine", 0.035],
    [760, 0.05, "sine", 0.028],
  ],
  move: [
    [260, 0.045, "triangle", 0.03],
    [390, 0.08, "triangle", 0.026],
  ],
  capture: [
    [420, 0.06, "sine", 0.04],
    [620, 0.07, "sine", 0.04],
    [840, 0.09, "sine", 0.035],
  ],
  warp: [
    [180, 0.08, "sawtooth", 0.035],
    [520, 0.12, "sine", 0.045],
    [1040, 0.12, "sine", 0.035],
    [740, 0.16, "triangle", 0.03],
  ],
  attack: [
    [120, 0.08, "square", 0.035],
    [90, 0.1, "sawtooth", 0.03],
  ],
  error: [
    [180, 0.09, "square", 0.025],
    [130, 0.1, "square", 0.022],
  ],
  apEmpty: [
    [880, 0.08, "square", 0.04],
    [440, 0.1, "square", 0.038],
    [220, 0.18, "sawtooth", 0.04],
  ],
  win: [
    [420, 0.08, "sine", 0.04],
    [560, 0.08, "sine", 0.04],
    [700, 0.12, "sine", 0.04],
    [980, 0.18, "triangle", 0.035],
  ],
};

let audioContext = null;

const TILE_TYPES = {
  base: { name: "星港基地", fill: "#20364f", moveCost: 1 },
  plain: { name: "普通星域", fill: "#162536", moveCost: 1 },
  resource: { name: "晶能矿带", fill: "#23472d", moveCost: 1 },
  nebula: { name: "星云", fill: "#352d59", moveCost: 2 },
  asteroid: { name: "陨石带", fill: "#3c3441", moveCost: 1 },
  warp: { name: "折跃门", fill: "#173d50", moveCost: 1 },
  center: { name: "中央星门", fill: "#51431f", moveCost: 1 },
};

let state;
let layout = { scale: 1, ox: 0, oy: 0 };
let hoverHex = null;
let toastTimer = 0;

function createInitialState() {
  const tiles = createMap();
  const units = createUnits();
  const players = Object.fromEntries(
    PLAYERS.map((player) => [
      player.id,
      {
        ...player,
        score: 0,
        resources: 0,
        ap: 6,
        apEmptyPlayed: false,
        visible: new Set(),
        explored: new Set(),
      },
    ]),
  );

  const next = {
    tiles,
    units,
    players,
    currentPlayerIndex: 0,
    round: 1,
    selectedUnitId: null,
    reachable: new Map(),
    log: ["赛季开始：蓝方先行动，中央星门将在争夺中持续计分。"],
    gameOver: false,
  };
  refreshVision(next);
  return next;
}

function createMap() {
  const tiles = new Map();
  for (let q = -MAP_RADIUS; q <= MAP_RADIUS; q += 1) {
    const rMin = Math.max(-MAP_RADIUS, -q - MAP_RADIUS);
    const rMax = Math.min(MAP_RADIUS, -q + MAP_RADIUS);
    for (let r = rMin; r <= rMax; r += 1) {
      const id = key(q, r);
      tiles.set(id, { id, q, r, type: "plain", owner: null });
    }
  }

  setTile(tiles, 0, 0, "center");
  [
    [-3, 0],
    [3, 0],
    [0, -3],
    [0, 3],
  ].forEach(([q, r]) => setTile(tiles, q, r, "warp"));

  [
    [-2, 2],
    [2, -2],
    [-4, 2],
    [4, -2],
    [-2, -2],
    [2, 2],
    [0, -5],
    [0, 5],
    [-5, 0],
    [5, 0],
  ].forEach(([q, r]) => setTile(tiles, q, r, "resource"));

  [
    [-1, -3],
    [1, 3],
    [-3, 2],
    [3, -2],
    [-2, 4],
    [2, -4],
  ].forEach(([q, r]) => setTile(tiles, q, r, "nebula"));

  [
    [-1, 2],
    [1, -2],
    [-4, 1],
    [4, -1],
    [-2, -1],
    [2, 1],
  ].forEach(([q, r]) => setTile(tiles, q, r, "asteroid"));

  const bases = [
    [-6, 0, "blue"],
    [6, 0, "red"],
    [0, -6, "green"],
    [0, 6, "gold"],
  ];
  bases.forEach(([q, r, owner]) => {
    const tile = setTile(tiles, q, r, "base");
    tile.owner = owner;
  });

  return tiles;
}

function createUnits() {
  const starts = {
    blue: [
      [-6, 0],
      [-5, 0],
      [-5, 1],
      [-6, 1],
    ],
    red: [
      [6, 0],
      [5, 0],
      [5, -1],
      [6, -1],
    ],
    green: [
      [0, -6],
      [0, -5],
      [1, -6],
      [1, -5],
    ],
    gold: [
      [0, 6],
      [0, 5],
      [-1, 6],
      [-1, 5],
    ],
  };
  const types = ["interceptor", "interceptor", "bomber", "awacs"];
  const units = [];
  Object.entries(starts).forEach(([owner, positions]) => {
    positions.forEach(([q, r], index) => {
      const type = types[index];
      units.push({
        id: `${owner}-${index + 1}`,
        owner,
        type,
        q,
        r,
        hp: UNIT_TYPES[type].maxHp,
        moved: false,
      });
    });
  });
  return units;
}

function setTile(tiles, q, r, type) {
  const tile = tiles.get(key(q, r));
  if (tile) tile.type = type;
  return tile;
}

function key(q, r) {
  return `${q},${r}`;
}

function parseKey(id) {
  return id.split(",").map(Number);
}

function currentPlayer() {
  return PLAYERS[state.currentPlayerIndex];
}

function currentPlayerState() {
  return state.players[currentPlayer().id];
}

function neighbors(q, r) {
  return [
    [q + 1, r],
    [q + 1, r - 1],
    [q, r - 1],
    [q - 1, r],
    [q - 1, r + 1],
    [q, r + 1],
  ];
}

function hexDistance(aq, ar, bq, br) {
  return (Math.abs(aq - bq) + Math.abs(aq + ar - bq - br) + Math.abs(ar - br)) / 2;
}

function pixelFromHex(q, r) {
  return {
    x: HEX_SIZE * SQRT3 * (q + r / 2),
    y: HEX_SIZE * 1.5 * r,
  };
}

function hexFromPixel(x, y) {
  const px = (x - layout.ox) / layout.scale;
  const py = (y - layout.oy) / layout.scale;
  const q = ((SQRT3 / 3) * px - (1 / 3) * py) / HEX_SIZE;
  const r = ((2 / 3) * py) / HEX_SIZE;
  return cubeRound(q, r);
}

function cubeRound(q, r) {
  let x = q;
  let z = r;
  let y = -x - z;
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const xDiff = Math.abs(rx - x);
  const yDiff = Math.abs(ry - y);
  const zDiff = Math.abs(rz - z);
  if (xDiff > yDiff && xDiff > zDiff) rx = -ry - rz;
  else if (yDiff > zDiff) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function updateLayout() {
  const rect = canvas.getBoundingClientRect();
  const mapWidth = HEX_SIZE * SQRT3 * (MAP_RADIUS * 2 + 1);
  const mapHeight = HEX_SIZE * 1.5 * (MAP_RADIUS * 2 + 1);
  layout.scale = Math.min(rect.width / (mapWidth + 180), rect.height / (mapHeight + 140), 1.15);
  layout.ox = rect.width / 2;
  layout.oy = rect.height / 2;
}

function draw() {
  if (!state) return;
  updateLayout();
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  drawBackground(rect);
  ctx.save();
  ctx.translate(layout.ox, layout.oy);
  ctx.scale(layout.scale, layout.scale);
  drawTiles();
  drawReachable();
  drawUnits();
  ctx.restore();
}

function drawBackground(rect) {
  const gradient = ctx.createLinearGradient(0, 0, rect.width, rect.height);
  gradient.addColorStop(0, "#07111d");
  gradient.addColorStop(1, "#101725");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  for (let i = 0; i < 90; i += 1) {
    const x = (i * 149) % rect.width;
    const y = (i * 83) % rect.height;
    ctx.fillRect(x, y, 1, 1);
  }
}

function drawTiles() {
  const playerState = currentPlayerState();
  for (const tile of state.tiles.values()) {
    const visible = playerState.visible.has(tile.id);
    const explored = playerState.explored.has(tile.id);
    drawHex(tile, visible, explored);
  }
}

function drawHex(tile, visible, explored) {
  const { x, y } = pixelFromHex(tile.q, tile.r);
  const type = TILE_TYPES[tile.type];
  const isHover = hoverHex && hoverHex.q === tile.q && hoverHex.r === tile.r;
  const activeUnit = selectedUnit();
  const selected = activeUnit && activeUnit.q === tile.q && activeUnit.r === tile.r;

  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    const px = x + HEX_SIZE * Math.cos(angle);
    const py = y + HEX_SIZE * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();

  ctx.fillStyle = explored ? type.fill : "#08111b";
  ctx.globalAlpha = visible ? 1 : explored ? 0.42 : 0.9;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = isHover ? "#d7f7ff" : selected ? "#ffffff" : "rgba(115, 154, 183, 0.34)";
  ctx.lineWidth = isHover || selected ? 2.4 : 1;
  ctx.stroke();

  if (!explored) {
    drawFog(x, y);
    return;
  }

  if (tile.owner) {
    ctx.strokeStyle = state.players[tile.owner].color;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  drawTileIcon(tile, x, y, visible);
}

function drawFog(x, y) {
  ctx.fillStyle = "rgba(3, 8, 13, 0.82)";
  ctx.beginPath();
  ctx.arc(x, y, 15, 0, Math.PI * 2);
  ctx.fill();
}

function drawTileIcon(tile, x, y, visible) {
  ctx.save();
  ctx.globalAlpha = visible ? 1 : 0.45;
  if (tile.type === "resource") {
    ctx.fillStyle = "#7dff9b";
    ctx.beginPath();
    ctx.moveTo(x, y - 14);
    ctx.lineTo(x + 12, y + 8);
    ctx.lineTo(x - 12, y + 8);
    ctx.closePath();
    ctx.fill();
  } else if (tile.type === "warp") {
    ctx.strokeStyle = "#42d9ff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.stroke();
  } else if (tile.type === "center") {
    ctx.strokeStyle = "#ffc857";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#ffc857";
    ctx.fillRect(x - 3, y - 18, 6, 36);
    ctx.fillRect(x - 18, y - 3, 36, 6);
  } else if (tile.type === "base") {
    ctx.fillStyle = tile.owner ? state.players[tile.owner].color : "#dbe8f7";
    ctx.fillRect(x - 13, y - 13, 26, 26);
  } else if (tile.type === "nebula") {
    ctx.strokeStyle = "#b797ff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x - 6, y, 8, 0, Math.PI * 2);
    ctx.arc(x + 8, y + 3, 10, 0, Math.PI * 2);
    ctx.stroke();
  } else if (tile.type === "asteroid") {
    ctx.fillStyle = "#c1a8a8";
    ctx.beginPath();
    ctx.arc(x - 7, y - 2, 5, 0, Math.PI * 2);
    ctx.arc(x + 7, y + 4, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawReachable() {
  ctx.save();
  for (const [tileId, cost] of state.reachable.entries()) {
    const [q, r] = parseKey(tileId);
    const { x, y } = pixelFromHex(q, r);
    ctx.fillStyle = cost === 0 ? "rgba(255,255,255,0.18)" : "rgba(66,217,255,0.18)";
    ctx.beginPath();
    ctx.arc(x, y, HEX_SIZE * 0.56, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawUnits() {
  const playerState = currentPlayerState();
  for (const unit of state.units) {
    const tileId = key(unit.q, unit.r);
    if (!playerState.visible.has(tileId) && unit.owner !== currentPlayer().id) continue;
    drawUnit(unit);
  }
}

function drawUnit(unit) {
  const { x, y } = pixelFromHex(unit.q, unit.r);
  const player = state.players[unit.owner];
  const type = UNIT_TYPES[unit.type];
  const selected = state.selectedUnitId === unit.id;
  ctx.save();
  ctx.shadowColor = player.color;
  ctx.shadowBlur = selected ? 18 : 8;
  ctx.fillStyle = player.color;
  ctx.strokeStyle = selected ? "#ffffff" : "#08111d";
  ctx.lineWidth = selected ? 3 : 2;

  ctx.beginPath();
  if (unit.type === "interceptor") {
    ctx.moveTo(x, y - 18);
    ctx.lineTo(x + 16, y + 14);
    ctx.lineTo(x, y + 7);
    ctx.lineTo(x - 16, y + 14);
  } else if (unit.type === "bomber") {
    ctx.moveTo(x, y - 17);
    ctx.lineTo(x + 17, y);
    ctx.lineTo(x, y + 17);
    ctx.lineTo(x - 17, y);
  } else {
    ctx.arc(x, y, 16, 0, Math.PI * 2);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#06111d";
  ctx.font = "700 12px Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(type.name.slice(0, 1), x, y);

  ctx.fillStyle = "#edf6ff";
  ctx.font = "700 11px Segoe UI, sans-serif";
  ctx.fillText(`${unit.hp}`, x + 20, y - 18);
  ctx.restore();
}

function selectedUnit() {
  return state.units.find((unit) => unit.id === state.selectedUnitId);
}

function unitAt(q, r) {
  return state.units.find((unit) => unit.q === q && unit.r === r);
}

function tileAt(q, r) {
  return state.tiles.get(key(q, r));
}

function computeReachable(unit) {
  const player = state.players[unit.owner];
  const frontier = [{ q: unit.q, r: unit.r, cost: 0 }];
  const costs = new Map([[key(unit.q, unit.r), 0]]);
  while (frontier.length) {
    const current = frontier.shift();
    for (const [nq, nr] of neighbors(current.q, current.r)) {
      const tile = tileAt(nq, nr);
      if (!tile || !player.explored.has(tile.id)) continue;
      const occupied = unitAt(nq, nr);
      if (occupied && occupied.owner === unit.owner) continue;
      const nextCost = current.cost + TILE_TYPES[tile.type].moveCost;
      if (nextCost > player.ap || nextCost > UNIT_TYPES[unit.type].move) continue;
      const id = key(nq, nr);
      if (!costs.has(id) || nextCost < costs.get(id)) {
        costs.set(id, nextCost);
        if (!occupied) frontier.push({ q: nq, r: nr, cost: nextCost });
      }
    }
  }
  return costs;
}

function refreshVision(targetState = state) {
  Object.values(targetState.players).forEach((player) => {
    player.visible = new Set();
  });

  for (const unit of targetState.units) {
    const player = targetState.players[unit.owner];
    const unitType = UNIT_TYPES[unit.type];
    for (const tile of targetState.tiles.values()) {
      if (hexDistance(unit.q, unit.r, tile.q, tile.r) <= unitType.vision) {
        player.visible.add(tile.id);
        player.explored.add(tile.id);
      }
    }
  }

  for (const tile of targetState.tiles.values()) {
    if (tile.owner) {
      const player = targetState.players[tile.owner];
      for (const other of targetState.tiles.values()) {
        if (hexDistance(tile.q, tile.r, other.q, other.r) <= 1) {
          player.visible.add(other.id);
          player.explored.add(other.id);
        }
      }
    }
  }
}

function selectUnit(unit) {
  if (!unit || unit.owner !== currentPlayer().id || state.gameOver) return;
  state.selectedUnitId = unit.id;
  state.reachable = computeReachable(unit);
  playSound("select");
  toast(`${UNIT_TYPES[unit.type].name} 已选中。蓝色光圈为可行动范围。`);
  renderUi();
  draw();
}

function handleCanvasClick(event) {
  if (state.gameOver || !currentPlayer().isHuman) return;
  const rect = canvas.getBoundingClientRect();
  const hex = hexFromPixel(event.clientX - rect.left, event.clientY - rect.top);
  const tile = tileAt(hex.q, hex.r);
  if (!tile) return;

  const clickedUnit = unitAt(hex.q, hex.r);
  if (clickedUnit && clickedUnit.owner === currentPlayer().id) {
    selectUnit(clickedUnit);
    return;
  }

  const unit = selectedUnit();
  if (!unit) {
    toast("先选择一支己方舰队。");
    return;
  }

  const targetKey = key(hex.q, hex.r);
  if (!state.reachable.has(targetKey)) {
    toast("目标超出行动范围，或尚未探索。");
    return;
  }

  if (clickedUnit && clickedUnit.owner !== currentPlayer().id) {
    attack(unit, clickedUnit);
  } else {
    moveUnit(unit, hex.q, hex.r, state.reachable.get(targetKey));
  }
  endIfNoActions();
  renderUi();
  draw();
}

function handleMouseMove(event) {
  const rect = canvas.getBoundingClientRect();
  const hex = hexFromPixel(event.clientX - rect.left, event.clientY - rect.top);
  hoverHex = tileAt(hex.q, hex.r) ? hex : null;
  draw();
}

function moveUnit(unit, q, r, cost) {
  currentPlayerState().ap -= cost;
  unit.q = q;
  unit.r = r;
  unit.moved = true;
  refreshVision();
  state.reachable = computeReachable(unit);
  const tile = tileAt(q, r);
  playSound("move");
  toast(`舰队移动至 ${TILE_TYPES[tile.type].name}，消耗 ${cost} 行动力。`);
}

function attack(attacker, defender) {
  const attackerType = UNIT_TYPES[attacker.type];
  const defenderType = UNIT_TYPES[defender.type];
  const tile = tileAt(defender.q, defender.r);
  const terrainBonus = tile.type === "asteroid" ? 1.2 : tile.type === "nebula" ? 1.1 : 1;
  const counter = attackerType.counter === defender.type ? 1.3 : 1;
  const support = nearbyAwacs(attacker.owner, attacker.q, attacker.r) ? 1.1 : 1;
  const atkPower = attackerType.atk * counter * support;
  const defPower = defenderType.def * terrainBonus;
  const apCost = 2;

  if (currentPlayerState().ap < apCost) {
    playSound("error");
    toast("行动力不足，无法攻击。");
    return;
  }

  currentPlayerState().ap -= apCost;
  attacker.moved = true;
  playSound("attack");

  if (atkPower >= defPower * 1.2) {
    defender.hp -= 2;
    addLog(`${playerName(attacker.owner)}的${attackerType.name}重创${playerName(defender.owner)}的${defenderType.name}。`);
  } else if (atkPower >= defPower * 0.85) {
    defender.hp -= 1;
    attacker.hp -= 1;
    addLog(`${attackerType.name}与${defenderType.name}交火，双方受损。`);
  } else {
    attacker.hp -= 1;
    addLog(`${playerName(attacker.owner)}进攻受阻，${attackerType.name}受损。`);
  }

  if (defender.hp <= 0) removeUnit(defender);
  if (attacker.hp <= 0) removeUnit(attacker);
  state.selectedUnitId = attacker.hp > 0 ? attacker.id : null;
  refreshVision();
  state.reachable = selectedUnit() ? computeReachable(selectedUnit()) : new Map();
}

function nearbyAwacs(owner, q, r) {
  return state.units.some(
    (unit) => unit.owner === owner && unit.type === "awacs" && hexDistance(q, r, unit.q, unit.r) <= 2,
  );
}

function removeUnit(unit) {
  state.units = state.units.filter((item) => item.id !== unit.id);
  addLog(`${playerName(unit.owner)}的${UNIT_TYPES[unit.type].name}被击毁。`);
}

function captureSelected() {
  const unit = selectedUnit();
  if (!unit || unit.owner !== currentPlayer().id || state.gameOver) return;
  const tile = tileAt(unit.q, unit.r);
  if (!["resource", "warp", "center"].includes(tile.type)) {
    playSound("error");
    toast("这里只是普通星域，无法占领。");
    return;
  }
  if (tile.owner === unit.owner) {
    playSound("error");
    toast("该据点已经属于你。");
    return;
  }
  if (currentPlayerState().ap < 2) {
    playSound("error");
    toast("行动力不足，占领需要 2 点行动力。");
    return;
  }
  currentPlayerState().ap -= 2;
  tile.owner = unit.owner;
  addLog(`${playerName(unit.owner)}占领了${TILE_TYPES[tile.type].name}。`);
  playSound("capture");
  toast(`${TILE_TYPES[tile.type].name}占领成功。`);
  refreshVision();
  renderUi();
  draw();
}

function warpSelected() {
  const unit = selectedUnit();
  if (!unit || unit.owner !== currentPlayer().id || state.gameOver) return;
  const tile = tileAt(unit.q, unit.r);
  const player = currentPlayerState();
  if (tile.type !== "warp" || tile.owner !== unit.owner) {
    playSound("error");
    toast("需要站在己方折跃门上才能折跃。");
    return;
  }
  if (player.ap < 3) {
    playSound("error");
    toast("行动力不足，折跃需要 3 点行动力。");
    return;
  }
  const gates = getWarpTargets(unit, player);
  if (!gates.length) {
    playSound("error");
    toast("还没有已探索且未被占用的其他折跃门。");
    return;
  }
  gates.sort((a, b) => hexDistance(a.q, a.r, 0, 0) - hexDistance(b.q, b.r, 0, 0));
  const target = gates[0];
  player.ap -= 3;
  unit.q = target.q;
  unit.r = target.r;
  addLog(`${playerName(unit.owner)}通过折跃门投送到${TILE_TYPES[target.type].name}。`);
  playSound("warp");
  toast("折跃完成：你已抵达另一座折跃门，可继续推进或占领。");
  refreshVision();
  state.reachable = computeReachable(unit);
  renderUi();
  draw();
}

function endTurn() {
  if (state.gameOver) return;
  awardIncomeAndScore();
  state.selectedUnitId = null;
  state.reachable = new Map();
  state.currentPlayerIndex += 1;
  if (state.currentPlayerIndex >= PLAYERS.length) {
    state.currentPlayerIndex = 0;
    state.round += 1;
  }

  if (state.round > MAX_ROUNDS) {
    finishGame();
    return;
  }

  const player = currentPlayerState();
  player.ap = 6;
  player.apEmptyPlayed = false;
  state.units.filter((unit) => unit.owner === currentPlayer().id).forEach((unit) => {
    unit.moved = false;
  });
  refreshVision();
  renderUi();
  draw();

  if (!currentPlayer().isHuman) {
    window.setTimeout(runAiTurn, 450);
  }
}

function awardIncomeAndScore() {
  for (const tile of state.tiles.values()) {
    if (!tile.owner) continue;
    if (tile.type === "resource") state.players[tile.owner].resources += 2;
    if (tile.type === "center") state.players[tile.owner].score += 10;
    if (tile.type === "warp") state.players[tile.owner].score += 1;
  }
}

function runAiTurn() {
  if (state.gameOver || currentPlayer().isHuman) return;
  const playerId = currentPlayer().id;
  let safety = 0;
  while (currentPlayerState().ap > 0 && safety < 8) {
    safety += 1;
    const units = state.units.filter((unit) => unit.owner === playerId);
    if (!units.length) break;
    let acted = false;

    for (const unit of units) {
      if (currentPlayerState().ap < 1) break;
      state.selectedUnitId = unit.id;
      state.reachable = computeReachable(unit);
      const targetEnemy = findReachableEnemy(unit);
      if (targetEnemy && currentPlayerState().ap >= 2) {
        attack(unit, targetEnemy);
        acted = true;
        break;
      }
      const targetTile = chooseAiTile(unit);
      if (targetTile) {
        moveUnit(unit, targetTile.q, targetTile.r, state.reachable.get(targetTile.id));
        if (["resource", "warp", "center"].includes(targetTile.type) && targetTile.owner !== playerId && currentPlayerState().ap >= 2) {
          targetTile.owner = playerId;
          currentPlayerState().ap -= 2;
          addLog(`${playerName(playerId)}占领了${TILE_TYPES[targetTile.type].name}。`);
        }
        acted = true;
        break;
      }
    }
    if (!acted) break;
  }
  endTurn();
}

function findReachableEnemy(unit) {
  for (const tileId of state.reachable.keys()) {
    const [q, r] = parseKey(tileId);
    const target = unitAt(q, r);
    if (target && target.owner !== unit.owner) return target;
  }
  return null;
}

function chooseAiTile(unit) {
  const options = [...state.reachable.keys()]
    .map((tileId) => state.tiles.get(tileId))
    .filter((tile) => tile && !unitAt(tile.q, tile.r));
  const unownedCenter = options.find((tile) => tile.type === "center" && tile.owner !== unit.owner);
  if (unownedCenter) return unownedCenter;
  const unownedWarp = options.find((tile) => tile.type === "warp" && tile.owner !== unit.owner);
  if (unownedWarp) return unownedWarp;
  const unownedResource = options.find((tile) => tile.type === "resource" && tile.owner !== unit.owner);
  if (unownedResource) return unownedResource;
  options.sort((a, b) => hexDistance(a.q, a.r, 0, 0) - hexDistance(b.q, b.r, 0, 0));
  return options[0];
}

function endIfNoActions() {
  const player = currentPlayerState();
  if (player.ap <= 0) {
    if (!player.apEmptyPlayed) {
      player.apEmptyPlayed = true;
      playSound("apEmpty");
    }
    toast("行动力耗尽，可以结束回合。");
  }
}

function finishGame() {
  state.gameOver = true;
  const ranking = Object.values(state.players).sort(
    (a, b) => b.score + b.resources - (a.score + a.resources),
  );
  const winner = ranking[0];
  els.resultTitle.textContent = `${winner.shortName}获胜`;
  els.resultText.textContent = `最终积分 ${winner.score}，资源 ${winner.resources}。中央星门、折跃门和资源点共同决定了这次赛季结算。`;
  els.resultModal.classList.add("open");
  els.resultModal.setAttribute("aria-hidden", "false");
  playSound("win");
  renderUi();
  draw();
}

function addLog(text) {
  state.log.unshift(text);
  state.log = state.log.slice(0, 9);
}

function playerName(id) {
  return state.players[id] ? state.players[id].shortName : id;
}

function renderUi() {
  const player = currentPlayer();
  const playerState = currentPlayerState();
  els.currentPlayerName.textContent = `${player.shortName} · ${player.name}`;
  els.currentPlayerName.style.color = player.color;
  els.turnInfo.textContent = `第 ${Math.min(state.round, MAX_ROUNDS)} / ${MAX_ROUNDS} 回合 · 行动力 ${playerState.ap}`;
  els.objectivePanel.textContent = getObjectiveHint();
  els.endTurnBtn.disabled = state.gameOver || !player.isHuman;
  els.captureBtn.disabled = !canCapture();
  els.warpBtn.disabled = !canWarp();

  els.scoreboard.innerHTML = PLAYERS.map((item) => {
    const ps = state.players[item.id];
    return `
      <div class="score-item" style="border-left-color:${item.color}">
        <strong>${item.shortName}</strong>
        <span>积分 ${ps.score} · 资源 ${ps.resources}</span>
        <span>据点 ${ownedCount(item.id)} · 舰队 ${unitCount(item.id)}</span>
      </div>
    `;
  }).join("");

  const unit = selectedUnit();
  if (!unit) {
    els.unitPanel.innerHTML = `<p class="hint">点击己方舰队查看状态。目标：占资源、控折跃门、争夺中央星门。</p>`;
  } else {
    const type = UNIT_TYPES[unit.type];
    const tile = tileAt(unit.q, unit.r);
    els.unitPanel.innerHTML = `
      <div class="unit-title">
        <strong>${type.name}</strong>
        <span class="unit-badge" style="background:${state.players[unit.owner].color}">${playerName(unit.owner)}</span>
      </div>
      <p class="unit-meta">位置 ${unit.q}, ${unit.r} · ${TILE_TYPES[tile.type].name}</p>
      <div class="unit-stats">
        <span>攻击 ${type.atk}</span>
        <span>防御 ${type.def}</span>
        <span>耐久 ${unit.hp}/${type.maxHp}</span>
      </div>
    `;
  }

  els.battleLog.innerHTML = state.log.map((item) => `<li>${item}</li>`).join("");
}

function canCapture() {
  const unit = selectedUnit();
  if (!unit || unit.owner !== currentPlayer().id || !currentPlayer().isHuman) return false;
  const tile = tileAt(unit.q, unit.r);
  return ["resource", "warp", "center"].includes(tile.type) && tile.owner !== unit.owner && currentPlayerState().ap >= 2;
}

function canWarp() {
  const unit = selectedUnit();
  if (!unit || unit.owner !== currentPlayer().id || !currentPlayer().isHuman) return false;
  const tile = tileAt(unit.q, unit.r);
  const player = currentPlayerState();
  return tile.type === "warp" && tile.owner === unit.owner && player.ap >= 3 && getWarpTargets(unit, player).length > 0;
}

function getWarpTargets(unit, player) {
  return [...state.tiles.values()].filter(
    (item) =>
      item.type === "warp" &&
      item.id !== key(unit.q, unit.r) &&
      player.explored.has(item.id) &&
      !unitAt(item.q, item.r),
  );
}

function ownedCount(playerId) {
  return [...state.tiles.values()].filter((tile) => tile.owner === playerId).length;
}

function unitCount(playerId) {
  return state.units.filter((unit) => unit.owner === playerId).length;
}

function getObjectiveHint() {
  if (state.gameOver) return "本局已经结算，可以点击「重新开始」再试一局。";
  if (!currentPlayer().isHuman) return `${currentPlayer().shortName}正在行动，等待 AI 回合结束。`;

  const unit = selectedUnit();
  if (!unit) {
    return "第一步：点击一支蓝方舰队。建议先占附近资源点，再向折跃门和中央星门推进。";
  }

  const tile = tileAt(unit.q, unit.r);
  if (canCapture()) {
    return `当前舰队站在${TILE_TYPES[tile.type].name}上，可以点击「占领」获得持续收益。`;
  }
  if (canWarp()) {
    return "当前舰队站在己方折跃门上，可以点击「折跃」跳到已探索的其他折跃门。";
  }
  if (currentPlayerState().ap <= 0) {
    return "行动力已用完，点击「结束回合」让其他阵营行动。";
  }
  return "点击蓝色光圈内的格子移动；如果光圈内有敌军，点击敌军即可攻击。";
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    els.toast.classList.remove("visible");
  }, 2600);
}

function getAudioContext() {
  if (!audioContext) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return null;
    audioContext = new AudioContextCtor();
  }
  if (audioContext.state === "suspended") {
    audioContext.resume();
  }
  return audioContext;
}

function playSound(name) {
  const context = getAudioContext();
  const pattern = AUDIO_PATTERNS[name];
  if (!context || !pattern) return;

  let offset = 0;
  for (const [frequency, duration, type, volume] of pattern) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime + offset;
    const end = start + duration;

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
    offset += duration * 0.72;
  }
}

function resetGame() {
  state = createInitialState();
  els.resultModal.classList.remove("open");
  els.resultModal.setAttribute("aria-hidden", "true");
  renderUi();
  draw();
  toast("Demo 已重置。蓝方行动：先占资源点，再尝试控制折跃门。");
}

canvas.addEventListener("click", handleCanvasClick);
canvas.addEventListener("mousemove", handleMouseMove);
els.endTurnBtn.addEventListener("click", endTurn);
els.captureBtn.addEventListener("click", captureSelected);
els.warpBtn.addEventListener("click", warpSelected);
els.resetBtn.addEventListener("click", resetGame);
els.playAgainBtn.addEventListener("click", resetGame);
window.addEventListener("resize", resizeCanvas);

resetGame();
resizeCanvas();
