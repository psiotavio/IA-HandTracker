const video = document.querySelector("#video");
const canvas = document.querySelector("#overlay");
const ctx = canvas.getContext("2d");
const spellCanvas = document.querySelector("#spell-canvas");
const spellCtx = spellCanvas.getContext("2d");

const cameraToggle = document.querySelector("#camera-toggle");
const switchCamera = document.querySelector("#switch-camera");
const clearSpell = document.querySelector("#clear-spell");
const fullscreenExit = document.querySelector("#fullscreen-exit");
const statusMessage = document.querySelector("#status-message");
const emptyState = document.querySelector("#empty-state");
const magicPill = document.querySelector("#magic-pill");
const magicStatus = document.querySelector("#magic-status");
const spellName = document.querySelector("#spell-name");
const handCount = document.querySelector("#hand-count");
const fpsLabel = document.querySelector("#fps");
const confidenceLabel = document.querySelector("#confidence");
const landmarkTable = document.querySelector("#landmark-table");

const maxHandsInput = document.querySelector("#max-hands");
const detectInput = document.querySelector("#detect-confidence");
const detectValue = document.querySelector("#detect-confidence-value");
const trackInput = document.querySelector("#track-confidence");
const trackValue = document.querySelector("#track-confidence-value");
const mirrorInput = document.querySelector("#mirror-view");
const showLabelsInput = document.querySelector("#show-labels");

const keyLandmarks = [
  ["Pulso", 0],
  ["Polegar", 4],
  ["Indicador", 8],
  ["Medio", 12],
  ["Anelar", 16],
  ["Mindinho", 20],
];

const SPELL_TRAIL_LIFETIME = 3000;
const SPELL_RECOGNITION_DELAY = 1000;
const AVADA_DURATION = 2400;
const LUMOS_DURATION = 2600;
const NOX_DURATION = 2600;

let hands;
let stream;
let running = false;
let facingMode = "user";
let frameCounter = 0;
let lastFpsTick = performance.now();
let frameLoopId = 0;
let magicMode = false;
let rockFrames = 0;
let lastRockToggle = 0;
let magicReadyAt = 0;
let lastSpellPoint = null;
let smoothedSpellPoint = null;
let spellSegments = [];
let currentStrokePoints = [];
let lastStrokeAt = 0;
let avadaEffect = null;
let avadaParticles = [];
let spellRenderRunning = false;
let lastSpellRenderAt = 0;
let spellNameTimer = 0;
let lumosTimer = 0;
let noxTimer = 0;
let handFullscreenState = "idle";
let handFullscreenCount = 0;
let lastHandFullscreenAt = 0;
let lastHandShape = null;
let lastFullscreenToggleAt = 0;

function setStatus(message) {
  statusMessage.textContent = message;
}

function updatePercentLabel(input, output) {
  output.textContent = `${Math.round(Number(input.value) * 100)}%`;
}

function fitCanvasToVideo() {
  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  if (spellCanvas.width !== width || spellCanvas.height !== height) {
    spellCanvas.width = width;
    spellCanvas.height = height;
    resetSpellState();
  }
}

function clearCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function clearSpellCanvas() {
  spellCtx.clearRect(0, 0, spellCanvas.width, spellCanvas.height);
  resetSpellState();
  hideSpellName();
  endLumos();
  endNox();
}

function resetSpellState() {
  lastSpellPoint = null;
  smoothedSpellPoint = null;
  spellSegments = [];
  currentStrokePoints = [];
  lastStrokeAt = 0;
  avadaEffect = null;
  avadaParticles = [];
}

function updateFps() {
  frameCounter += 1;
  const now = performance.now();

  if (now - lastFpsTick >= 1000) {
    fpsLabel.textContent = String(Math.round((frameCounter * 1000) / (now - lastFpsTick)));
    frameCounter = 0;
    lastFpsTick = now;
  }
}

function setupHands() {
  if (!window.Hands) {
    throw new Error("MediaPipe Hands nao foi carregado. Verifique a conexao com a internet.");
  }

  hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });

  hands.setOptions({
    maxNumHands: Number(maxHandsInput.value),
    modelComplexity: 1,
    minDetectionConfidence: Number(detectInput.value),
    minTrackingConfidence: Number(trackInput.value),
  });

  hands.onResults(drawResults);
}

function updateOptions() {
  updatePercentLabel(detectInput, detectValue);
  updatePercentLabel(trackInput, trackValue);

  if (!hands) {
    return;
  }

  hands.setOptions({
    maxNumHands: Number(maxHandsInput.value),
    modelComplexity: 1,
    minDetectionConfidence: Number(detectInput.value),
    minTrackingConfidence: Number(trackInput.value),
  });
}

async function startCamera() {
  if (!hands) {
    setupHands();
  }

  if (running) {
    running = false;
    frameLoopId += 1;
    lastSpellPoint = null;
    smoothedSpellPoint = null;
  }

  stopStream();
  setStatus("Abrindo câmera...");

  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode,
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });

  video.srcObject = stream;
  await video.play();

  fitCanvasToVideo();
  running = true;
  emptyState.classList.add("hidden");
  cameraToggle.textContent = "Parar câmera";
  switchCamera.disabled = false;
  setStatus("Rastreamento ativo. Mostre a palma da mão para calibrar mais rápido.");
  lastFpsTick = performance.now();
  frameCounter = 0;

  const activeLoopId = ++frameLoopId;
  requestAnimationFrame(() => processFrame(activeLoopId));
}

function stopStream() {
  if (!stream) {
    return;
  }

  stream.getTracks().forEach((track) => track.stop());
  stream = null;
}

function stopCamera() {
  running = false;
  frameLoopId += 1;
  stopStream();
  clearCanvas();
  clearSpellCanvas();
  setCameraFullscreen(false);
  rockFrames = 0;
  setMagicMode(false, "Câmera desligada.");
  handCount.textContent = "0";
  fpsLabel.textContent = "0";
  confidenceLabel.textContent = "--";
  landmarkTable.innerHTML = '<p class="table-empty">Nenhuma mão detectada ainda.</p>';
  cameraToggle.textContent = "Iniciar câmera";
  switchCamera.disabled = true;
  emptyState.classList.remove("hidden");
  setStatus("Câmera desligada.");
}

function handleFullscreenGesture(landmarks, now) {
  if (!landmarks.length || now - lastFullscreenToggleAt < 1600) {
    resetFullscreenGestureIfStale(now);
    return;
  }

  const hand = landmarks[0];
  const shape = isOpenHand(hand) ? "open" : isClosedHand(hand) ? "closed" : null;

  if (!shape) {
    resetFullscreenGestureIfStale(now);
    lastHandShape = null;
    return;
  }

  if (shape === lastHandShape) {
    return;
  }

  lastHandShape = shape;

  if (now - lastHandFullscreenAt > 2600) {
    handFullscreenState = "idle";
    handFullscreenCount = 0;
  }

  lastHandFullscreenAt = now;

  if (shape === "open") {
    handFullscreenState = "open-ready";
    return;
  }

  if (shape === "closed" && handFullscreenState === "open-ready") {
    handFullscreenCount += 1;
    handFullscreenState = "closed-ready";

    if (handFullscreenCount >= 2) {
      setCameraFullscreen(!document.body.classList.contains("camera-fullscreen"));
      lastFullscreenToggleAt = now;
      handFullscreenState = "idle";
      handFullscreenCount = 0;
      lastHandShape = null;
    }
  }
}

function resetFullscreenGestureIfStale(now) {
  if (now - lastHandFullscreenAt > 2600) {
    handFullscreenState = "idle";
    handFullscreenCount = 0;
  }
}

function isOpenHand(hand) {
  return (
    isFingerExtended(hand, 8, 6) &&
    isFingerExtended(hand, 12, 10) &&
    isFingerExtended(hand, 16, 14) &&
    isFingerExtended(hand, 20, 18)
  );
}

function isClosedHand(hand) {
  return (
    isFingerFolded(hand, 8, 6) &&
    isFingerFolded(hand, 12, 10) &&
    isFingerFolded(hand, 16, 14) &&
    isFingerFolded(hand, 20, 18)
  );
}

function setCameraFullscreen(enabled) {
  document.body.classList.toggle("camera-fullscreen", enabled);
  setStatus(
    enabled
      ? "Tela cheia ativada pelo gesto de abrir e fechar a mão duas vezes."
      : "Tela cheia desativada.",
  );
}

async function processFrame(loopId) {
  if (!running || !hands || loopId !== frameLoopId) {
    return;
  }

  fitCanvasToVideo();
  await hands.send({ image: video });
  if (!running || loopId !== frameLoopId) {
    return;
  }
  updateFps();
  requestAnimationFrame(() => processFrame(loopId));
}

function drawResults(results) {
  const width = canvas.width;
  const height = canvas.height;
  const isMirrored = mirrorInput.checked;

  ctx.save();
  ctx.clearRect(0, 0, width, height);

  if (isMirrored) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }

  ctx.drawImage(results.image, 0, 0, width, height);

  const landmarks = results.multiHandLandmarks || [];
  const handedness = results.multiHandedness || [];
  handleFullscreenGesture(landmarks, performance.now());

  landmarks.forEach((hand, index) => {
    window.drawConnectors(ctx, hand, window.HAND_CONNECTIONS, {
      color: "#33d17a",
      lineWidth: 4,
    });
    window.drawLandmarks(ctx, hand, {
      color: "#ff6b57",
      fillColor: "#f7b731",
      lineWidth: 2,
      radius: 4,
    });

    if (showLabelsInput.checked) {
      drawLandmarkLabels(hand, width, height, isMirrored);
    }

    drawHandBadge(hand, handedness[index], width, height, isMirrored);
  });

  ctx.restore();
  handleMagicMode(landmarks, width, height, isMirrored);
  updateReadout(landmarks, handedness);
}

function handleMagicMode(landmarks, width, height, isMirrored) {
  const now = performance.now();
  const rockHand = landmarks.find(isRockGesture);

  if (rockHand) {
    rockFrames += 1;
  } else {
    rockFrames = 0;
  }

  if (rockFrames >= 7 && now - lastRockToggle > 1500) {
    setMagicMode(
      !magicMode,
      magicMode ? "Modo Harry Potter desligado pelo gesto 🤘." : "Modo Harry Potter ativo. A varinha agora é o indicador.",
    );
    lastRockToggle = now;
    rockFrames = 0;
  }

  if (!magicMode || now < magicReadyAt) {
    lastSpellPoint = null;
    smoothedSpellPoint = null;
    return;
  }

  if (
    avadaEffect ||
    document.body.classList.contains("lumos-casting") ||
    document.body.classList.contains("nox-casting")
  ) {
    lastSpellPoint = null;
    smoothedSpellPoint = null;
    return;
  }

  const drawingHand = landmarks.find((hand) => isIndexDrawingPose(hand) && !isRockGesture(hand));

  if (!drawingHand) {
    lastSpellPoint = null;
    smoothedSpellPoint = null;
    maybeResolveSpellStroke(now, width, height);
    return;
  }

  const fingertip = drawingHand[8];
  const rawX = fingertip.x * width;
  const point = {
    x: isMirrored ? width - rawX : rawX,
    y: fingertip.y * height,
  };

  drawSpellStroke(point, now, width, height);
}

function setMagicMode(enabled, customStatus) {
  magicMode = enabled;
  document.body.classList.toggle("magic-mode", magicMode);
  clearSpell.disabled = !magicMode;
  lastSpellPoint = null;
  smoothedSpellPoint = null;
  currentStrokePoints = [];
  magicReadyAt = magicMode ? performance.now() + 650 : 0;

  if (magicMode) {
    magicPill.textContent = "Modo Harry Potter ativo";
    magicStatus.textContent = "Raio: Avada. Traço horizontal: Lumos. Círculo: Nox.";
    setStatus(customStatus || "Modo Harry Potter ativo. A varinha agora é o indicador.");
  } else {
    magicPill.textContent = "🤘 ativa o modo Harry Potter";
    magicStatus.textContent = "Faça 🤘 para ativar. Raio: Avada. Traço horizontal: Lumos. Círculo: Nox.";
    if (customStatus) {
      setStatus(customStatus);
    }
  }
}

function isRockGesture(hand) {
  return (
    isFingerExtended(hand, 8, 6) &&
    isFingerFolded(hand, 12, 10) &&
    isFingerFolded(hand, 16, 14) &&
    isFingerExtended(hand, 20, 18)
  );
}

function isIndexDrawingPose(hand) {
  return (
    isFingerExtended(hand, 8, 6) &&
    isFingerFolded(hand, 12, 10) &&
    isFingerFolded(hand, 16, 14) &&
    isFingerFolded(hand, 20, 18)
  );
}

function isFingerExtended(hand, tipIndex, pipIndex) {
  return hand[tipIndex].y < hand[pipIndex].y - 0.025;
}

function isFingerFolded(hand, tipIndex, pipIndex) {
  return hand[tipIndex].y > hand[pipIndex].y + 0.015;
}

function drawSpellStroke(point, now, width, height) {
  const maxJump = Math.min(width, height) * 0.22;
  const minStep = Math.min(width, height) * 0.009;
  const smoothPoint = smoothSpellPoint(point, width, height);
  const hasLastPoint = lastSpellPoint && distance(lastSpellPoint, smoothPoint) < maxJump;

  if (lastSpellPoint && distance(lastSpellPoint, smoothPoint) < minStep) {
    maybeResolveSpellStroke(now, width, height);
    return;
  }

  if (hasLastPoint) {
    spellSegments.push({
      from: lastSpellPoint,
      to: smoothPoint,
      bornAt: now,
      life: SPELL_TRAIL_LIFETIME,
      color: "gold",
    });
    currentStrokePoints.push({ ...smoothPoint, at: now });
  } else {
    currentStrokePoints = [];
    currentStrokePoints.push({ ...smoothPoint, at: now });
  }

  lastSpellPoint = smoothPoint;
  lastStrokeAt = now;
  pruneSpellSegments(now);
  ensureSpellRenderLoop();
}

function smoothSpellPoint(point, width, height) {
  if (!smoothedSpellPoint) {
    smoothedSpellPoint = point;
    return point;
  }

  const movement = distance(smoothedSpellPoint, point);
  const adaptiveAlpha = clamp(movement / (Math.min(width, height) * 0.06), 0.45, 0.92);
  smoothedSpellPoint = {
    x: smoothedSpellPoint.x + (point.x - smoothedSpellPoint.x) * adaptiveAlpha,
    y: smoothedSpellPoint.y + (point.y - smoothedSpellPoint.y) * adaptiveAlpha,
  };

  return smoothedSpellPoint;
}

function renderSpellLayer(width, height, now) {
  spellCtx.clearRect(0, 0, width, height);
  pruneSpellSegments(now);
  renderTrailSegments(now);
  renderAvadaEffect(width, height, now);
}

function ensureSpellRenderLoop() {
  if (spellRenderRunning) {
    return;
  }

  spellRenderRunning = true;
  requestAnimationFrame(renderSpellFrame);
}

function renderSpellFrame(now) {
  if (!spellCanvas.width || !spellCanvas.height) {
    spellRenderRunning = false;
    return;
  }

  const targetFrameMs = 33;
  if (now - lastSpellRenderAt < targetFrameMs) {
    requestAnimationFrame(renderSpellFrame);
    return;
  }

  lastSpellRenderAt = now;
  renderSpellLayer(spellCanvas.width, spellCanvas.height, now);

  if (spellSegments.length || avadaEffect) {
    requestAnimationFrame(renderSpellFrame);
    return;
  }

  spellRenderRunning = false;
}

function renderTrailSegments(now) {
  spellSegments.forEach((segment) => {
    const age = now - segment.bornAt;
    const lifeRatio = clamp(1 - age / segment.life, 0, 1);
    const alpha = easeOutCubic(lifeRatio);
    const hue = segment.color === "green" ? "110, 255, 85" : "255, 228, 122";
    const core = segment.color === "green" ? "210, 255, 188" : "255, 249, 213";

    spellCtx.save();
    spellCtx.globalCompositeOperation = "lighter";
    spellCtx.lineCap = "round";
    spellCtx.lineJoin = "round";
    spellCtx.shadowColor = `rgba(${hue}, ${0.42 * alpha})`;
    spellCtx.shadowBlur = 10 * alpha;
    spellCtx.strokeStyle = `rgba(${hue}, ${0.76 * alpha})`;
    spellCtx.lineWidth = 8 * alpha + 2;
    drawSegmentPath(segment);
    spellCtx.stroke();

    spellCtx.shadowBlur = 3 * alpha;
    spellCtx.strokeStyle = `rgba(${core}, ${0.94 * alpha})`;
    spellCtx.lineWidth = 3.2 * alpha + 0.8;
    drawSegmentPath(segment);
    spellCtx.stroke();
    drawSpellSpark(segment.to, segment.color, alpha);
    spellCtx.restore();
  });
}

function drawSegmentPath(segment) {
  const control = {
    x: (segment.from.x + segment.to.x) / 2,
    y: (segment.from.y + segment.to.y) / 2,
  };

  spellCtx.beginPath();
  spellCtx.moveTo(segment.from.x, segment.from.y);
  spellCtx.quadraticCurveTo(control.x, control.y, segment.to.x, segment.to.y);
}

function drawSpellSpark(point, color = "gold", alpha = 1) {
  if (Math.random() > 0.006) {
    return;
  }

  const radius = 2 + Math.random() * 5;
  const offsetX = (Math.random() - 0.5) * 28;
  const offsetY = (Math.random() - 0.5) * 28;
  const fill = color === "green" ? "210, 255, 188" : "255, 249, 213";

  spellCtx.fillStyle = `rgba(${fill}, ${0.86 * alpha})`;
  spellCtx.beginPath();
  spellCtx.arc(point.x + offsetX, point.y + offsetY, radius, 0, Math.PI * 2);
  spellCtx.fill();
}

function maybeResolveSpellStroke(now, width, height) {
  if (!currentStrokePoints.length || now - lastStrokeAt < SPELL_RECOGNITION_DELAY) {
    return;
  }

  if (isNoxStroke(currentStrokePoints, width, height)) {
    triggerNox();
  } else if (isLumosStroke(currentStrokePoints, width, height)) {
    triggerLumos();
  } else if (isLightningStroke(currentStrokePoints, width, height)) {
    triggerAvadaKedavra(width, height, now);
  }

  currentStrokePoints = [];
}

function isLumosStroke(points, width, height) {
  if (points.length < 5) {
    return false;
  }

  const box = getBounds(points);
  const path = pathLength(points);
  const direct = distance(points[0], points.at(-1));
  const horizontalTravel = Math.abs(points.at(-1).x - points[0].x);
  const verticalTravel = Math.abs(points.at(-1).y - points[0].y);
  const flatness = box.height / Math.max(1, box.width);
  const straightness = direct / Math.max(1, path);

  return (
    box.width > width * 0.09 &&
    box.height < height * 0.18 &&
    horizontalTravel > width * 0.075 &&
    verticalTravel < height * 0.14 &&
    flatness < 0.72 &&
    straightness > 0.58
  );
}

function isNoxStroke(points, width, height) {
  if (points.length < 10) {
    return false;
  }

  const box = getBounds(points);
  const size = Math.min(width, height);
  const closureDistance = distance(points[0], points.at(-1));
  const path = pathLength(points);
  const diagonal = Math.hypot(box.width, box.height);
  const ratio = box.width / Math.max(1, box.height);

  return (
    box.width > width * 0.08 &&
    box.height > height * 0.08 &&
    ratio > 0.42 &&
    ratio < 2.25 &&
    closureDistance < size * 0.22 &&
    path > diagonal * 1.45 &&
    path < diagonal * 4.25
  );
}

function isLightningStroke(points, width, height) {
  if (points.length < 9) {
    return false;
  }

  const simplified = simplifyStroke(points, Math.min(width, height) * 0.045);
  if (simplified.length < 4 || simplified.length > 9) {
    return false;
  }

  const box = getBounds(points);
  const path = pathLength(points);
  const diagonal = Math.hypot(box.width, box.height);
  const totalDrop = Math.abs(points.at(-1).y - points[0].y);
  const directionChanges = countHorizontalDirectionChanges(simplified);
  const sharpCorners = countSharpCorners(simplified);

  return (
    box.height > height * 0.14 &&
    box.width > width * 0.035 &&
    path > diagonal * 1.22 &&
    totalDrop > box.height * 0.45 &&
    directionChanges >= 2 &&
    sharpCorners >= 2
  );
}

function simplifyStroke(points, epsilon) {
  if (points.length <= 2) {
    return points;
  }

  let farthestIndex = 0;
  let farthestDistance = 0;
  const start = points[0];
  const end = points.at(-1);

  for (let index = 1; index < points.length - 1; index += 1) {
    const pointDistance = perpendicularDistance(points[index], start, end);
    if (pointDistance > farthestDistance) {
      farthestDistance = pointDistance;
      farthestIndex = index;
    }
  }

  if (farthestDistance <= epsilon) {
    return [start, end];
  }

  const left = simplifyStroke(points.slice(0, farthestIndex + 1), epsilon);
  const right = simplifyStroke(points.slice(farthestIndex), epsilon);
  return left.slice(0, -1).concat(right);
}

function perpendicularDistance(point, lineStart, lineEnd) {
  const lineLength = distance(lineStart, lineEnd);
  if (!lineLength) {
    return distance(point, lineStart);
  }

  return (
    Math.abs(
      (lineEnd.y - lineStart.y) * point.x -
        (lineEnd.x - lineStart.x) * point.y +
        lineEnd.x * lineStart.y -
        lineEnd.y * lineStart.x,
    ) / lineLength
  );
}

function getBounds(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function pathLength(points) {
  return points.slice(1).reduce((total, point, index) => total + distance(points[index], point), 0);
}

function countHorizontalDirectionChanges(points) {
  const directions = points
    .slice(1)
    .map((point, index) => Math.sign(point.x - points[index].x))
    .filter(Boolean);

  return directions.slice(1).reduce((changes, direction, index) => {
    return direction !== directions[index] ? changes + 1 : changes;
  }, 0);
}

function countSharpCorners(points) {
  let corners = 0;

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const angle = angleBetween(previous, current, next);

    if (angle < 125) {
      corners += 1;
    }
  }

  return corners;
}

function angleBetween(previous, current, next) {
  const ax = previous.x - current.x;
  const ay = previous.y - current.y;
  const bx = next.x - current.x;
  const by = next.y - current.y;
  const dot = ax * bx + ay * by;
  const magA = Math.hypot(ax, ay);
  const magB = Math.hypot(bx, by);

  if (!magA || !magB) {
    return 180;
  }

  return (Math.acos(clamp(dot / (magA * magB), -1, 1)) * 180) / Math.PI;
}

function triggerAvadaKedavra(width, height, now) {
  const stroke = currentStrokePoints.slice();
  const boltPoints = createAvadaBolt(stroke, width, height);
  const source = boltPoints[0];

  spellSegments = [];
  currentStrokePoints = [];
  lastSpellPoint = null;
  smoothedSpellPoint = null;
  avadaEffect = {
    startedAt: now,
    duration: AVADA_DURATION,
    source,
    boltPoints,
    branches: createAvadaBranches(boltPoints, width, height),
  };
  avadaParticles = Array.from({ length: 46 }, () => createAvadaParticle(width, height, avadaEffect));
  showSpellName("Avada Kedavra", "avada-casting", AVADA_DURATION);
  ensureSpellRenderLoop();
  magicPill.textContent = "Avada Kedavra";
  magicStatus.textContent = "Raio reconhecido. Efeito verde lançado.";
  setStatus("Avada Kedavra reconhecido. Faiscas verdes lançadas.");
}

function triggerLumos() {
  spellSegments = [];
  currentStrokePoints = [];
  lastSpellPoint = null;
  smoothedSpellPoint = null;
  spellCtx.clearRect(0, 0, spellCanvas.width, spellCanvas.height);
  showSpellName("Lumos", "lumos-casting", LUMOS_DURATION);

  window.clearTimeout(lumosTimer);
  lumosTimer = window.setTimeout(() => {
    if (magicMode) {
      magicPill.textContent = "Modo Harry Potter ativo";
      magicStatus.textContent = "Raio: Avada. Traço horizontal: Lumos. Círculo: Nox.";
    }
  }, LUMOS_DURATION);

  magicPill.textContent = "Lumos";
  magicStatus.textContent = "Lumos reconhecido. Clarão branco lançado.";
  setStatus("Lumos reconhecido. Clarão branco lançado.");
}

function endLumos() {
  window.clearTimeout(lumosTimer);
  document.body.classList.remove("lumos-casting");
}

function triggerNox() {
  spellSegments = [];
  currentStrokePoints = [];
  lastSpellPoint = null;
  smoothedSpellPoint = null;
  spellCtx.clearRect(0, 0, spellCanvas.width, spellCanvas.height);
  showSpellName("Nox", "nox-casting", NOX_DURATION);

  window.clearTimeout(noxTimer);
  noxTimer = window.setTimeout(() => {
    if (magicMode) {
      magicPill.textContent = "Modo Harry Potter ativo";
      magicStatus.textContent = "Raio: Avada. Traço horizontal: Lumos. Círculo: Nox.";
    }
  }, NOX_DURATION);

  magicPill.textContent = "Nox";
  magicStatus.textContent = "Nox reconhecido. Escuridão lançada.";
  setStatus("Nox reconhecido. Escuridão lançada.");
}

function endNox() {
  window.clearTimeout(noxTimer);
  document.body.classList.remove("nox-casting");
}

function createAvadaParticle(width, height, effect) {
  const start = pointOnPolyline(effect.boltPoints, Math.random());
  const angle = Math.random() * Math.PI * 2;
  const travel = Math.min(width, height) * (0.08 + Math.random() * 0.34);

  return {
    sx: start.x,
    sy: start.y,
    ex: clamp(start.x + Math.cos(angle) * travel, -width * 0.08, width * 1.08),
    ey: clamp(start.y + Math.sin(angle) * travel, -height * 0.08, height * 1.08),
    radius: 1.2 + Math.random() * 3.2,
    delay: Math.random() * 420,
    life: 820 + Math.random() * 780,
    wobble: 4 + Math.random() * 15,
    phase: Math.random() * Math.PI * 2,
  };
}

function renderAvadaEffect(width, height, now) {
  if (!avadaEffect) {
    return;
  }

  const age = now - avadaEffect.startedAt;
  if (age > avadaEffect.duration) {
    avadaEffect = null;
    avadaParticles = [];
    document.body.classList.remove("avada-casting");
    if (magicMode) {
      magicPill.textContent = "Modo Harry Potter ativo";
      magicStatus.textContent = "Raio: Avada. Traço horizontal: Lumos. Círculo: Nox.";
    }
    return;
  }

  const progress = age / avadaEffect.duration;
  const alpha = effectEnvelope(progress);
  const pulse = 0.5 + 0.5 * Math.sin(progress * Math.PI * 10);

  spellCtx.save();
  spellCtx.globalCompositeOperation = "lighter";

  drawAvadaRings(avadaEffect, alpha, progress);
  drawAvadaBolt(effectWithJitter(avadaEffect, progress), alpha, pulse);
  drawAvadaParticles(age, alpha, pulse);

  spellCtx.restore();
}

function drawAvadaBolt(effect, alpha, pulse) {
  spellCtx.lineCap = "round";
  spellCtx.lineJoin = "round";

  spellCtx.shadowColor = `rgba(68, 255, 54, ${0.66 * alpha})`;
  spellCtx.shadowBlur = 18 + pulse * 10;
  spellCtx.strokeStyle = `rgba(36, 255, 72, ${0.34 * alpha})`;
  spellCtx.lineWidth = 24 + pulse * 8;
  drawPolyline(effect.boltPoints);
  spellCtx.stroke();

  spellCtx.shadowBlur = 10 + pulse * 6;
  spellCtx.strokeStyle = `rgba(118, 255, 84, ${0.84 * alpha})`;
  spellCtx.lineWidth = 10 + pulse * 3;
  drawPolyline(effect.boltPoints);
  spellCtx.stroke();

  spellCtx.shadowBlur = 5 + pulse * 3;
  spellCtx.strokeStyle = `rgba(230, 255, 213, ${0.96 * alpha})`;
  spellCtx.lineWidth = 3.5 + pulse * 1.5;
  drawPolyline(effect.boltPoints);
  spellCtx.stroke();

  spellCtx.shadowBlur = 6;
  spellCtx.strokeStyle = `rgba(166, 255, 126, ${0.34 * alpha})`;
  spellCtx.lineWidth = 2;
  effect.branches.forEach((branch) => {
    drawPolyline(branch);
    spellCtx.stroke();
  });
}

function drawAvadaRings(effect, alpha, progress) {
  for (let ring = 0; ring < 2; ring += 1) {
    const ringProgress = (progress * 1.35 + ring * 0.34) % 1;
    const radius = 18 + ringProgress * 150;
    const ringAlpha = alpha * (1 - ringProgress) * 0.42;

    spellCtx.strokeStyle = `rgba(168, 255, 117, ${ringAlpha})`;
    spellCtx.lineWidth = 5 * (1 - ringProgress) + 1;
    spellCtx.shadowColor = `rgba(57, 255, 77, ${ringAlpha})`;
    spellCtx.shadowBlur = 8;
    spellCtx.beginPath();
    spellCtx.arc(effect.source.x, effect.source.y, radius, 0, Math.PI * 2);
    spellCtx.stroke();
  }
}

function drawAvadaParticles(age, alpha, pulse) {
  spellCtx.lineCap = "round";
  spellCtx.shadowBlur = 0;
  avadaParticles.forEach((particle) => {
    const localAge = Math.max(0, age - particle.delay);
    const particleProgress = clamp(localAge / particle.life, 0, 1);

    if (!localAge || particleProgress >= 1) {
      return;
    }

    const eased = easeOutCubic(particleProgress);
    const particleAlpha = alpha * (1 - particleProgress) * 0.95;
    const wobble = Math.sin(particleProgress * 10 + particle.phase) * particle.wobble;
    const x = particle.sx + (particle.ex - particle.sx) * eased + wobble;
    const y = particle.sy + (particle.ey - particle.sy) * eased - wobble * 0.22;
    const tailX = particle.sx + (particle.ex - particle.sx) * Math.max(0, eased - 0.05);
    const tailY = particle.sy + (particle.ey - particle.sy) * Math.max(0, eased - 0.05);

    spellCtx.strokeStyle = `rgba(196, 255, 174, ${particleAlpha})`;
    spellCtx.lineWidth = particle.radius;
    spellCtx.beginPath();
    spellCtx.moveTo(tailX, tailY);
    spellCtx.lineTo(x, y);
    spellCtx.stroke();
  });
}

function drawPolyline(points) {
  spellCtx.beginPath();
  spellCtx.moveTo(points[0].x, points[0].y);

  points.slice(1).forEach((point) => {
    spellCtx.lineTo(point.x, point.y);
  });
}

function createAvadaBolt(stroke, width, height) {
  const fallback = [
    { x: width * 0.42, y: height * 0.2 },
    { x: width * 0.56, y: height * 0.42 },
    { x: width * 0.46, y: height * 0.42 },
    { x: width * 0.61, y: height * 0.78 },
  ];

  if (stroke.length < 4) {
    return fallback;
  }

  const simplified = simplifyStroke(stroke, Math.min(width, height) * 0.032);
  const points = simplified.length >= 4 ? simplified : stroke;
  return resamplePolyline(points, 7);
}

function resamplePolyline(points, targetCount) {
  const total = pathLength(points);

  if (!total) {
    return points;
  }

  return Array.from({ length: targetCount }, (_, index) => {
    return pointOnPolyline(points, index / (targetCount - 1));
  });
}

function pointOnPolyline(points, amount) {
  const total = pathLength(points);
  let remaining = total * clamp(amount, 0, 1);

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segmentLength = distance(start, end);

    if (remaining <= segmentLength || index === points.length - 1) {
      const segmentAmount = segmentLength ? remaining / segmentLength : 0;
      return {
        x: start.x + (end.x - start.x) * segmentAmount,
        y: start.y + (end.y - start.y) * segmentAmount,
      };
    }

    remaining -= segmentLength;
  }

  return points.at(-1);
}

function createAvadaBranches(points, width, height) {
  const size = Math.min(width, height);
  return points.slice(1, -1).map((point, index) => {
    const previous = points[index];
    const next = points[index + 2];
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const side = index % 2 ? 1 : -1;
    const branchLength = size * (0.05 + Math.random() * 0.06);
    const normal = { x: (-dy / length) * side, y: (dx / length) * side };

    return [
      point,
      {
        x: point.x + normal.x * branchLength + dx * 0.08,
        y: point.y + normal.y * branchLength + dy * 0.08,
      },
    ];
  });
}

function effectWithJitter(effect, progress) {
  const jitter = 3.5 + Math.sin(progress * Math.PI * 12) * 2.5;
  const boltPoints = effect.boltPoints.map((point, index) => {
    if (index === 0 || index === effect.boltPoints.length - 1) {
      return point;
    }

    return {
      x: point.x + Math.sin(progress * 34 + index * 1.7) * jitter,
      y: point.y + Math.cos(progress * 29 + index * 1.3) * jitter,
    };
  });

  return { ...effect, boltPoints };
}

function showSpellName(name, castingClass, duration) {
  window.clearTimeout(spellNameTimer);
  spellName.textContent = name;
  document.body.classList.remove("avada-casting", "lumos-casting", "nox-casting");
  document.body.classList.add(castingClass);
  spellName.classList.remove("is-visible");
  void spellName.offsetWidth;
  spellName.classList.add("is-visible");
  spellNameTimer = window.setTimeout(hideSpellName, duration);
}

function hideSpellName() {
  window.clearTimeout(spellNameTimer);
  spellName.classList.remove("is-visible");
  document.body.classList.remove("avada-casting", "lumos-casting", "nox-casting");
}

function effectEnvelope(progress) {
  if (progress < 0.18) {
    return easeOutCubic(progress / 0.18);
  }

  if (progress > 0.64) {
    return easeOutCubic((1 - progress) / 0.36);
  }

  return 1;
}

function pruneSpellSegments(now) {
  spellSegments = spellSegments.filter((segment) => now - segment.bornAt < segment.life);
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - clamp(value, 0, 1), 3);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function drawLandmarkLabels(hand, width, height, isMirrored) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  ctx.font = "700 13px SFMono-Regular, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  hand.forEach((point, index) => {
    const rawX = point.x * width;
    const x = isMirrored ? width - rawX : rawX;
    const y = point.y * height;
    ctx.fillStyle = "rgba(16, 18, 15, 0.78)";
    ctx.beginPath();
    ctx.arc(x, y - 16, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f4f1e8";
    ctx.fillText(String(index), x, y - 16);
  });
  ctx.restore();
}

function drawHandBadge(hand, handedness, width, height, isMirrored) {
  const wrist = hand[0];
  const rawX = wrist.x * width;
  const x = isMirrored ? width - rawX : rawX;
  const y = wrist.y * height;
  const label = handedness?.label ? translateHandLabel(handedness.label, isMirrored) : "Mão";
  const score = handedness?.score ? ` ${Math.round(handedness.score * 100)}%` : "";

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = "800 14px Avenir Next, Segoe UI, sans-serif";
  const text = `${label}${score}`;
  const textWidth = ctx.measureText(text).width + 24;
  const badgeX = Math.max(12, Math.min(width - textWidth - 12, x - textWidth / 2));
  const badgeY = Math.max(12, y - 58);

  ctx.fillStyle = "rgba(244, 241, 232, 0.92)";
  roundRect(ctx, badgeX, badgeY, textWidth, 34, 8);
  ctx.fill();
  ctx.fillStyle = "#10120f";
  ctx.fillText(text, badgeX + 12, badgeY + 22);
  ctx.restore();
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function translateHandLabel(label, isMirrored) {
  const visibleLabel = isMirrored
    ? label === "Left"
      ? "Right"
      : label === "Right"
        ? "Left"
        : label
    : label;

  return visibleLabel === "Left" ? "Esquerda" : visibleLabel === "Right" ? "Direita" : visibleLabel;
}

function updateReadout(landmarks, handedness) {
  handCount.textContent = String(landmarks.length);

  const bestScore = handedness.reduce((highest, item) => Math.max(highest, item.score || 0), 0);
  confidenceLabel.textContent = bestScore ? `${Math.round(bestScore * 100)}%` : "--";

  if (!landmarks.length) {
    landmarkTable.innerHTML = '<p class="table-empty">Nenhuma mão detectada ainda.</p>';
    return;
  }

  const firstHand = landmarks[0];
  landmarkTable.innerHTML = keyLandmarks
    .map(([label, index]) => {
      const point = firstHand[index];
      return `
        <div class="landmark-row">
          <strong>${label} #${index}</strong>
          <span>x ${point.x.toFixed(3)} · y ${point.y.toFixed(3)} · z ${point.z.toFixed(3)}</span>
        </div>
      `;
    })
    .join("");
}

async function toggleCamera() {
  if (running) {
    stopCamera();
    return;
  }

  try {
    await startCamera();
  } catch (error) {
    running = false;
    stopStream();
    cameraToggle.textContent = "Iniciar câmera";
    switchCamera.disabled = true;
    emptyState.classList.remove("hidden");
    setStatus(error.message || "Não foi possível abrir a câmera.");
  }
}

async function flipCamera() {
  facingMode = facingMode === "user" ? "environment" : "user";
  if (running) {
    await startCamera();
  }
}

cameraToggle.addEventListener("click", toggleCamera);
switchCamera.addEventListener("click", flipCamera);
fullscreenExit.addEventListener("click", () => setCameraFullscreen(false));
clearSpell.addEventListener("click", () => {
  clearSpellCanvas();
  setStatus("Feitiço limpo. O modo Harry Potter continua ativo.");
});
maxHandsInput.addEventListener("change", updateOptions);
detectInput.addEventListener("input", updateOptions);
trackInput.addEventListener("input", updateOptions);
mirrorInput.addEventListener("change", () => setStatus("Visualização atualizada."));
showLabelsInput.addEventListener("change", () => setStatus("Numeração dos pontos atualizada."));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.body.classList.contains("camera-fullscreen")) {
    setCameraFullscreen(false);
  }
});

updateOptions();

if (!navigator.mediaDevices?.getUserMedia) {
  cameraToggle.disabled = true;
  setStatus("Este navegador não disponibiliza acesso à câmera via getUserMedia.");
}
