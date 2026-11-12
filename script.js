const view = document.querySelector("#curtain");
const viewCtx = view.getContext("2d");
const video = document.querySelector("#camera");
const cameraButton = document.querySelector("#camera-button");
const statusLine = document.querySelector("#status");
const panel = document.querySelector(".panel");

const mask = document.createElement("canvas");
const maskCtx = mask.getContext("2d");
const foil = document.createElement("canvas");
const foilCtx = foil.getContext("2d");
const cameraFrame = document.createElement("canvas");
const cameraCtx = cameraFrame.getContext("2d");
const backFrame = document.createElement("canvas");
const backCtx = backFrame.getContext("2d");
const motion = document.createElement("canvas");
motion.width = 48;
motion.height = 36;
const motionCtx = motion.getContext("2d", { willReadFrequently: true });

const strandImage = new Image();
strandImage.src = "strand.png";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let strands = [];
let backStrands = [];
let backBands = [];
let layoutWidth = 0;
let pixelRatio = 1;
let viewX = 0;
let viewY = 0;
let targetX = 0;
let targetY = 0;
let cameraOn = false;
let stream = null;
let previousMotion = null;
let frameCount = 0;
let running = false;

function setStatus(message) {
  statusLine.textContent = message;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function resizeCanvas(canvas, ctx, width, height, dpr) {
  const bufferWidth = Math.round(width * dpr);
  const bufferHeight = Math.round(height * dpr);
  if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
    canvas.width = bufferWidth;
    canvas.height = bufferHeight;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function buildStrands(width) {
  const count = Math.max(1, Math.round(width / 40));
  const step = width / count;
  const strandWidth = step * 0.52;
  strands = [];

  for (let index = 0; index < count; index += 1) {
    strands.push({
      x: index * step + (step - strandWidth) / 2,
      width: strandWidth,
      factor: ((index % 5) - 2) / 2,
    });
  }

  const backCount = Math.max(1, Math.round(width / 72));
  const backSpan = width + 200;
  const backStep = backSpan / backCount;
  const backWidth = backStep * 0.92;
  backStrands = [];

  for (let index = 0; index < backCount; index += 1) {
    backStrands.push({
      x: -100 + index * backStep,
      width: backWidth,
      factor: ((index % 3) - 1),
    });
  }

  const bandCount = Math.max(1, Math.round(width / 110));
  const bandWidth = width / bandCount;
  backBands = [];

  for (let index = 0; index < bandCount; index += 1) {
    backBands.push({
      x: index * bandWidth,
      width: bandWidth + 1,
      factor: ((index % 4) - 1.5) / 1.5,
    });
  }

  layoutWidth = width;
}

function cameraLive() {
  return cameraOn && video.readyState >= 2 && video.videoWidth > 0;
}

function coverFit(sourceWidth, sourceHeight, destWidth, destHeight) {
  const scale = Math.max(destWidth / sourceWidth, destHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (destWidth - width) / 2,
    y: (destHeight - height) / 2,
    width,
    height,
  };
}

function updateMotionTarget() {
  if (video.readyState < 2 || video.videoWidth === 0) return;

  motionCtx.drawImage(video, 0, 0, motion.width, motion.height);
  const current = motionCtx.getImageData(0, 0, motion.width, motion.height).data;
  const prior = previousMotion;
  previousMotion = new Uint8ClampedArray(current);
  if (!prior) return;

  let weightX = 0;
  let weightY = 0;
  let count = 0;

  for (let index = 0; index < motion.width * motion.height; index += 1) {
    const offset = index * 4;
    const luminance = current[offset] * 0.299 + current[offset + 1] * 0.587 + current[offset + 2] * 0.114;
    const previous = prior[offset] * 0.299 + prior[offset + 1] * 0.587 + prior[offset + 2] * 0.114;
    if (Math.abs(luminance - previous) < 60) continue;

    count += 1;
    weightX += index % motion.width;
    weightY += Math.floor(index / motion.width);
  }

  if (count < 8) return;

  const centroidX = weightX / count;
  const centroidY = weightY / count;
  targetX = clamp(1 - (centroidX / (motion.width - 1)) * 2, -1, 1);
  targetY = clamp((centroidY / (motion.height - 1)) * 2 - 1, -1, 1);
}

function updateViewer() {
  frameCount += 1;

  if (cameraOn && frameCount % 2 === 0) {
    updateMotionTarget();
  }

  const ease = reducedMotion.matches ? 1 : 0.08;
  viewX += (targetX - viewX) * ease;
  viewY += (targetY - viewY) * ease;
}

function drawStrandSet(ctx, set, height, shiftX, shiftY, originY = 0) {
  ctx.save();
  ctx.filter = "grayscale(1) brightness(1.85) contrast(1.18)";
  set.forEach((strand) => {
    ctx.drawImage(
      strandImage,
      strand.x + shiftX * strand.factor,
      originY + shiftY * strand.factor,
      strand.width,
      height
    );
  });
  ctx.restore();
}

function drawStrands(ctx, height) {
  drawStrandSet(ctx, strands, height, 0, 0);
}

function drawCamera(width, height) {
  cameraCtx.clearRect(0, 0, width, height);
  cameraCtx.save();
  cameraCtx.translate(width, 0);
  cameraCtx.scale(-1, 1);
  cameraCtx.filter = "grayscale(1) contrast(0.68) brightness(1.32)";
  const fitted = coverFit(video.videoWidth, video.videoHeight, width, height);
  cameraCtx.drawImage(video, fitted.x, fitted.y, fitted.width, fitted.height);
  cameraCtx.restore();
  cameraCtx.filter = "none";
}

function paintSlices(height) {
  maskCtx.save();
  maskCtx.globalCompositeOperation = "source-atop";
  maskCtx.globalAlpha = 0.82;

  strands.forEach((strand) => {
    const offsetX = viewX * 34 * strand.factor;
    const offsetY = viewY * 22 * strand.factor;
    maskCtx.drawImage(
      cameraFrame,
      (strand.x + offsetX) * pixelRatio,
      offsetY * pixelRatio,
      strand.width * pixelRatio,
      height * pixelRatio,
      strand.x,
      0,
      strand.width,
      height
    );
  });

  maskCtx.restore();
}

function paintFoilPass(width, height, shiftX, shiftY, operation, alpha) {
  foilCtx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  foilCtx.clearRect(0, 0, width, height);
  foilCtx.globalCompositeOperation = "source-over";
  foilCtx.globalAlpha = 1;
  drawStrandSet(foilCtx, strands, height, shiftX, shiftY);
  foilCtx.globalCompositeOperation = "destination-in";
  foilCtx.drawImage(mask, 0, 0, width, height);

  maskCtx.save();
  maskCtx.globalCompositeOperation = operation;
  maskCtx.globalAlpha = alpha;
  maskCtx.drawImage(foil, 0, 0, width, height);
  maskCtx.restore();
}

function paintTexture(width, height) {
  const live = cameraLive();
  paintFoilPass(width, height, viewX * 14, viewY * 20, live ? "overlay" : "soft-light", live ? 0.8 : 0.5);
  if (!live) return;
  paintFoilPass(width, height, viewX * -8, viewY * -12, "multiply", 0.34);
}

function paintGlints(height) {
  maskCtx.save();
  maskCtx.globalCompositeOperation = "source-atop";
  const strength = 0.16 + Math.abs(viewX) * 0.7;
  const band = height * 0.22;

  strands.forEach((strand, index) => {
    const centre = height * (0.5 + viewY * 0.28 + (((index % 5) - 2) / 2) * 0.1);
    const gradient = maskCtx.createLinearGradient(0, centre - band, 0, centre + band);
    gradient.addColorStop(0, "rgba(255, 255, 255, 0)");
    gradient.addColorStop(0.5, `rgba(255, 255, 255, ${strength})`);
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    maskCtx.fillStyle = gradient;
    maskCtx.fillRect(strand.x, 0, strand.width, height);
  });

  maskCtx.restore();
}

function drawBackgroundPlate(width, height) {
  backCtx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  backCtx.clearRect(0, 0, width, height);
  backCtx.save();
  backCtx.translate(width, 0);
  backCtx.scale(-1, 1);
  backCtx.filter = "grayscale(1) contrast(0.62) brightness(1.36)";
  const fitted = coverFit(video.videoWidth, video.videoHeight, width, height);
  const zoom = 1.35;
  const plateWidth = fitted.width * zoom;
  const plateHeight = fitted.height * zoom;
  backCtx.drawImage(video, (width - plateWidth) / 2, (height - plateHeight) / 2, plateWidth, plateHeight);
  backCtx.restore();
  backCtx.filter = "none";
}

function drawBackground(width, height) {
  const originX = width * (0.5 - viewX * 0.22);
  const originY = height * (0.42 - viewY * 0.18);
  const background = viewCtx.createRadialGradient(
    originX,
    originY,
    Math.min(width, height) * 0.08,
    originX,
    originY,
    Math.max(width, height) * 0.75
  );
  background.addColorStop(0, "#5c6b7c");
  background.addColorStop(1, "#2a333e");
  viewCtx.fillStyle = background;
  viewCtx.fillRect(0, 0, width, height);

  if (!cameraLive()) {
    viewCtx.save();
    viewCtx.globalAlpha = 0.22;
    viewCtx.translate(-viewX * 52, -viewY * 34);
    drawStrandSet(viewCtx, backStrands, height + 90, viewX * -18, viewY * -16, -40);
    viewCtx.restore();
    return;
  }

  drawBackgroundPlate(width, height);

  backBands.forEach((band) => {
    const slide = -viewX * (28 + 46 * band.factor);
    const rise = -viewY * (18 + 16 * band.factor);
    viewCtx.drawImage(
      backFrame,
      (band.x + slide) * pixelRatio,
      rise * pixelRatio,
      band.width * pixelRatio,
      height * pixelRatio,
      band.x,
      0,
      band.width,
      height
    );
  });
}

function drawFrame(width, height) {
  maskCtx.clearRect(0, 0, width, height);
  drawStrands(maskCtx, height);

  if (cameraLive()) {
    drawCamera(width, height);
    paintSlices(height);
  }

  paintTexture(width, height);
  paintGlints(height);
  drawBackground(width, height);

  viewCtx.save();
  viewCtx.translate(viewX * 14, viewY * 10);
  viewCtx.shadowColor = "rgba(0, 0, 0, 0.55)";
  viewCtx.shadowBlur = reducedMotion.matches ? 8 : 18;
  viewCtx.shadowOffsetX = viewX * 12;
  viewCtx.shadowOffsetY = viewY * 6;
  viewCtx.drawImage(mask, 0, 0, width, height);
  viewCtx.restore();

  const travel = reducedMotion.matches ? 6 : 12;
  panel.style.transform = `translate(${(-viewX * travel).toFixed(2)}px, ${(-viewY * travel * 0.75).toFixed(2)}px)`;
}

function frame() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  pixelRatio = dpr;

  resizeCanvas(view, viewCtx, width, height, dpr);
  resizeCanvas(mask, maskCtx, width, height, dpr);
  resizeCanvas(foil, foilCtx, width, height, dpr);
  resizeCanvas(cameraFrame, cameraCtx, width, height, dpr);
  resizeCanvas(backFrame, backCtx, width, height, dpr);

  if (width !== layoutWidth) buildStrands(width);

  updateViewer();
  drawFrame(width, height);
  requestAnimationFrame(frame);
}

function start() {
  if (running) return;
  running = true;
  requestAnimationFrame(frame);
}

function pointerPosition(event) {
  const bounds = view.getBoundingClientRect();
  targetX = clamp(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -1, 1);
  targetY = clamp(((event.clientY - bounds.top) / bounds.height) * 2 - 1, -1, 1);
}

window.addEventListener("pointermove", (event) => {
  if (cameraOn) return;
  pointerPosition(event);
});

window.addEventListener("pointerdown", (event) => {
  if (cameraOn || event.target === cameraButton) return;
  pointerPosition(event);
});

window.addEventListener("pointerleave", () => {
  if (cameraOn) return;
  targetX = 0;
  targetY = 0;
});

async function enableCamera() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    setStatus("The camera needs a secure page, such as localhost or https. Move the pointer to shift the curtain.");
    return;
  }

  cameraButton.disabled = true;
  setStatus("Asking for the camera…");

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
    });
    video.srcObject = stream;
    await video.play();
    cameraOn = true;
    previousMotion = null;
    cameraButton.textContent = "Turn off camera";
    setStatus("Camera on. Move in front of it and the curtain follows.");
  } catch (error) {
    cameraOn = false;
    const blocked = error && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError" || error.name === "SecurityError");
    setStatus(
      blocked
        ? "Camera blocked. Allow camera access for this page in the browser, or move the pointer instead."
        : "The camera could not start. Move the pointer to shift the curtain."
    );
  } finally {
    cameraButton.disabled = false;
  }
}

function disableCamera() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
  stream = null;
  video.srcObject = null;
  cameraOn = false;
  previousMotion = null;
  targetX = 0;
  targetY = 0;
  cameraButton.textContent = "Turn on camera";
  setStatus("Camera off. Move the pointer to shift the curtain.");
}

cameraButton.addEventListener("click", () => {
  if (cameraOn) disableCamera();
  else enableCamera();
});

strandImage.onload = start;
strandImage.onerror = () => {
  setStatus("The tinsel strand image did not load.");
};

window.addEventListener("resize", () => {
  layoutWidth = 0;
});

if (strandImage.complete && strandImage.naturalWidth) start();
