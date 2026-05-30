import L from "leaflet";
import "leaflet-draw";
import { simplify_freehand, detect_freehand_shape } from "./core/pkg/e2e_core.js";
import { state } from "./state.js";
import { t } from "./i18n.js";
import { playStroke, playUndo, playRedo, playSave } from "./sounds.js";
import { COLORS, validateHex } from "./helpers.js";

const DEFAULT_COLOR = "#7c3aed";
const DEFAULT_WIDTH = 3;
const MIN_WIDTH = 1;
const MAX_WIDTH = 12;

let toggleBtn = null;
let toolbar = null;
let onDoneCb = null;
let pointerId = null;
let colorDots = [];
let widthBtn = null;
let widthPopout = null;
let hexInput = null;
let shapeActive = false;
let _drawCreatedHandler = null;
let _drawStopHandler = null;

export function initFreeDraw(doneCb) {
  onDoneCb = doneCb;
}

export function addFreeDrawButton() {
  createToggleButton();
  createToolbar();
  setupPointerEvents();
}

function createToggleButton() {
  toggleBtn = L.DomUtil.create("button");
  toggleBtn.textContent = "✏️";
  toggleBtn.title = t("freeDraw");
  toggleBtn.style.cssText =
    "position:absolute;top:135px;right:8px;z-index:1000;width:36px;height:36px;border:none;border-radius:4px;background:#7c3aed;color:white;font-size:18px;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;";
  toggleBtn.onclick = (e) => {
    e.stopPropagation();
    if (state.freeDrawing) {
      if (state.freeStrokes.length > 0) {
        finishDrawing(true);
      } else {
        exitDrawingMode();
      }
    } else {
      enterDrawingMode();
    }
  };
  state.map.getContainer().appendChild(toggleBtn);
}

export function enterDrawingMode() {
  state.freeDrawing = true;
  toggleBtn.style.background = "#5b21b6";
  state.map.getContainer().style.cursor = "crosshair";
  state.map.getContainer().style.touchAction = "none";
  state.map.dragging.disable();
  state.freeStrokeColor = DEFAULT_COLOR;
  state.freeStrokeWidth = DEFAULT_WIDTH;
  updateToolbarSelections();
  showToolbar();
  navigator.vibrate?.(12);
}

export function exitDrawingMode() {
  state.freeDrawing = false;
  toggleBtn.style.background = "#7c3aed";
  state.map.getContainer().style.cursor = "";
  state.map.getContainer().style.touchAction = "";
  state.map.dragging.enable();
  if (_drawCreatedHandler) { state.map.off(L.Draw.Event.CREATED, _drawCreatedHandler); _drawCreatedHandler = null; }
  if (_drawStopHandler) { state.map.off(L.Draw.Event.DRAWSTOP, _drawStopHandler); _drawStopHandler = null; }
  hideToolbar();
  if (state.freePreview) {
    state.map.removeLayer(state.freePreview);
    state.freePreview = null;
  }
  state.freePoints = [];
}

function discardAll() {
  state.freeStrokes.forEach((s) => state.map.removeLayer(s.layer));
  state.freeStrokes.length = 0;
  state.freeUndoStack.length = 0;
}

function finishDrawing(save) {
  if (save && state.freeStrokes.length > 0 && onDoneCb) {
    exitDrawingMode();
    const features = state.freeStrokes.map((stroke) => {
      let geometry;
      if (stroke.shape?.type === "circle") {
        geometry = { type: "Point", coordinates: [stroke.shape.center[0], stroke.shape.center[1]] };
      } else if (stroke.shape?.type === "rectangle") {
        geometry = { type: "Polygon", coordinates: [[...stroke.shape.corners, stroke.shape.corners[0]]] };
      } else {
        geometry = { type: "LineString", coordinates: stroke.points };
      }
      const props = { color: stroke.color, "stroke-width": stroke.width, "stroke-opacity": stroke.opacity };
      if (stroke.shape?.type === "circle") props.radius = stroke.shape.radius;
      return { type: "Feature", geometry, properties: props };
    });
    const collection = { type: "FeatureCollection", features };
    discardAll();
    onDoneCb(collection);
    navigator.vibrate?.(20);
    playSave();
  } else {
    discardAll();
    exitDrawingMode();
  }
}

function createToolbar() {
  toolbar = document.createElement("div");
  toolbar.id = "free-draw-toolbar";
  toolbar.style.cssText =
    "position:absolute;bottom:24px;left:50%;transform:translateX(-50%);z-index:1000;" +
    "display:none;background:var(--bg-glass);backdrop-filter:blur(4px);" +
    "border-radius:12px;padding:8px 12px;box-shadow:0 2px 12px rgba(0,0,0,0.2);" +
    "align-items:center;gap:8px;flex-wrap:wrap;justify-content:center;";

  const colorRow = document.createElement("div");
  colorRow.style.cssText = "display:flex;gap:4px;align-items:center;";
  colorDots = [];
  COLORS.forEach((c) => {
    const dot = document.createElement("span");
    dot.style.cssText =
      `width:24px;height:24px;background:${c};border-radius:50%;cursor:pointer;` +
      `border:2px solid ${c === DEFAULT_COLOR ? "var(--text)" : "transparent"};` +
      "flex-shrink:0;";
    dot.dataset.color = c;
    dot.onclick = () => setColor(c);
    colorRow.appendChild(dot);
    colorDots.push(dot);
  });

  const hueDot = document.createElement("span");
  hueDot.style.cssText =
    "width:24px;height:24px;border-radius:50%;cursor:pointer;" +
    "border:2px solid transparent;flex-shrink:0;" +
    "background:conic-gradient(red,yellow,lime,cyan,blue,magenta,red);" +
    "background-size:140% 140%;background-position:center;";
  hueDot.onclick = (e) => {
    e.stopPropagation();
    const picker = document.createElement("input");
    picker.type = "color";
    picker.value = state.freeStrokeColor;
    picker.style.cssText = "position:absolute;width:0;height:0;opacity:0;pointer-events:none;";
    if (document.body.classList.contains("dark")) picker.style.colorScheme = "dark";
    state.map.getContainer().appendChild(picker);
    picker.oninput = () => {
      setColor(picker.value);
      hueDot.style.border = "2px solid var(--text)";
      colorDots.forEach((d) => (d.style.border = "2px solid transparent"));
    };
    picker.onblur = () => picker.remove();
    picker.click();
  };
  hueDot.title = t("color") || "Color";
  colorRow.appendChild(hueDot);
  colorDots.push(hueDot);

  const hexInputEl = document.createElement("input");
  hexInputEl.type = "text";
  hexInputEl.value = DEFAULT_COLOR;
  hexInputEl.placeholder = "#hex";
  hexInputEl.style.cssText =
    "width:58px;height:24px;border:1px solid var(--border);border-radius:4px;" +
    "background:var(--bg-input);color:var(--text);font-size:11px;padding:0 4px;" +
    "box-sizing:border-box;flex-shrink:0;font-family:monospace;";
  hexInputEl.oninput = () => {
    const color = validateHex(hexInputEl.value);
    if (color) setColor(color);
  };
  hexInputEl.onblur = () => {
    hexInputEl.value = state.freeStrokeColor;
  };
  colorRow.appendChild(hexInputEl);
  hexInput = hexInputEl;
  toolbar.appendChild(colorRow);

  const sep1 = document.createElement("div");
  sep1.style.cssText =
    "width:1px;height:22px;background:var(--border);margin:0 2px;flex-shrink:0;";
  toolbar.appendChild(sep1);

  widthBtn = document.createElement("button");
  widthBtn.style.cssText =
    "width:28px;height:28px;border:none;border-radius:4px;background:transparent;" +
    "cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:0;";
  widthBtn.onclick = (e) => {
    e.stopPropagation();
    toggleWidthPopout();
  };
  toolbar.appendChild(widthBtn);

  widthPopout = document.createElement("div");
  widthPopout.id = "free-draw-width-popout";
  widthPopout.style.cssText =
    "position:absolute;bottom:52px;left:50%;transform:translateX(-50%);z-index:1001;" +
    "display:none;background:var(--bg-glass);backdrop-filter:blur(4px);" +
    "border-radius:8px;padding:8px 12px;box-shadow:0 2px 12px rgba(0,0,0,0.2);" +
    "align-items:center;gap:8px;";
  const sliderLabel = document.createElement("span");
  sliderLabel.style.cssText =
    "font-size:12px;color:var(--text-dim);white-space:nowrap;";
  sliderLabel.textContent = "1";
  widthPopout.appendChild(sliderLabel);
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = MIN_WIDTH;
  slider.max = MAX_WIDTH;
  slider.step = 1;
  slider.value = DEFAULT_WIDTH;
  slider.style.cssText =
    "width:100px;accent-color:var(--blue);cursor:pointer;";
  slider.oninput = () => {
    const v = parseInt(slider.value, 10);
    setWidth(v);
    sliderLabel.textContent = v;
  };
  widthPopout.appendChild(slider);
  const sliderMax = document.createElement("span");
  sliderMax.style.cssText =
    "font-size:12px;color:var(--text-dim);white-space:nowrap;";
  sliderMax.textContent = MAX_WIDTH;
  widthPopout.appendChild(sliderMax);
  state.map.getContainer().appendChild(widthPopout);

  document.addEventListener("pointerdown", (e) => {
    if (
      widthPopout.style.display === "flex" &&
      !widthPopout.contains(e.target) &&
      e.target !== widthBtn
    ) {
      widthPopout.style.display = "none";
    }
  });

  const sep2 = document.createElement("div");
  sep2.style.cssText =
    "width:1px;height:22px;background:var(--border);margin:0 2px;flex-shrink:0;";
  toolbar.appendChild(sep2);

  const highlightBtn = document.createElement("button");
  highlightBtn.textContent = "🖍";
  highlightBtn.title = "Highlighter";
  highlightBtn.style.cssText =
    "width:28px;height:28px;border:none;border-radius:4px;background:transparent;" +
    "color:var(--text);cursor:pointer;font-size:16px;display:flex;align-items:center;" +
    "justify-content:center;flex-shrink:0;";
  highlightBtn.onclick = () => {
    state.highlighting = !state.highlighting;
    highlightBtn.style.background = state.highlighting ? "var(--blue)" : "transparent";
    highlightBtn.style.color = state.highlighting ? "white" : "var(--text)";
  };
  toolbar.appendChild(highlightBtn);

  const undoBtn = document.createElement("button");
  undoBtn.textContent = "↩";
  undoBtn.title = t("undo") || "Undo";
  undoBtn.style.cssText =
    "width:28px;height:28px;border:none;border-radius:4px;background:transparent;" +
    "color:var(--text);cursor:pointer;font-size:16px;display:flex;align-items:center;" +
    "justify-content:center;flex-shrink:0;";
  undoBtn.onclick = undo;
  toolbar.appendChild(undoBtn);

  const redoBtn = document.createElement("button");
  redoBtn.textContent = "↪";
  redoBtn.title = t("redo") || "Redo";
  redoBtn.style.cssText =
    "width:28px;height:28px;border:none;border-radius:4px;background:transparent;" +
    "color:var(--text);cursor:pointer;font-size:16px;display:flex;align-items:center;" +
    "justify-content:center;flex-shrink:0;";
  redoBtn.onclick = redo;
  toolbar.appendChild(redoBtn);

  const snapBtn = document.createElement("button");
  snapBtn.textContent = "⬡";
  snapBtn.title = "Snap to shape";
  snapBtn.style.cssText =
    "width:28px;height:28px;border:none;border-radius:4px;background:transparent;" +
    "color:var(--text);cursor:pointer;font-size:16px;display:flex;align-items:center;" +
    "justify-content:center;flex-shrink:0;";
  snapBtn.onclick = () => {
    state.snapping = !state.snapping;
    snapBtn.style.background = state.snapping ? "var(--blue)" : "transparent";
    snapBtn.style.color = state.snapping ? "white" : "var(--text)";
  };
  toolbar.appendChild(snapBtn);

  const sep3 = document.createElement("div");
  sep3.style.cssText =
    "width:1px;height:22px;background:var(--border);margin:0 2px;flex-shrink:0;";
  toolbar.appendChild(sep3);

  const doneBtn = document.createElement("button");
  doneBtn.textContent = t("save");
  doneBtn.style.cssText =
    "height:28px;border:none;border-radius:4px;background:#16a34a;color:white;" +
    "cursor:pointer;font-size:13px;font-weight:600;padding:0 10px;flex-shrink:0;";
  doneBtn.onclick = () => finishDrawing(true);
  toolbar.appendChild(doneBtn);

  const discardBtn = document.createElement("button");
  discardBtn.textContent = t("discard");
  discardBtn.style.cssText =
    "height:28px;border:1px solid #dc2626;border-radius:4px;background:transparent;" +
    "color:#dc2626;cursor:pointer;font-size:13px;font-weight:600;padding:0 10px;flex-shrink:0;";
  discardBtn.onclick = () => {
    discardAll();
    exitDrawingMode();
  };
  toolbar.appendChild(discardBtn);

  const sep4 = document.createElement("div");
  sep4.style.cssText =
    "width:1px;height:22px;background:var(--border);margin:0 2px;flex-shrink:0;";
  toolbar.appendChild(sep4);

  const shapeOpts = { color: "#2563eb", weight: 2, fillOpacity: 0.15 };
  const svgLine =
    '<svg width="16" height="16" viewBox="0 0 16 16"><polyline points="2,14 6,6 10,10 14,2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const svgPoly =
    '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 2L14 6L12 12L4 12L2 6Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  const svgRect =
    '<svg width="16" height="16" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" fill="none" stroke="currentColor" stroke-width="1.5" rx="1"/></svg>';
  const svgCirc =
    '<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
  const toolDefs = [
    { title: t("polyline"), svg: svgLine, create: () => new L.Draw.Polyline(state.map, { shapeOptions: shapeOpts }) },
    { title: t("polygon"), svg: svgPoly, create: () => new L.Draw.Polygon(state.map, { shapeOptions: shapeOpts, allowIntersection: false, showArea: true }) },
    { title: t("rectangle"), svg: svgRect, create: () => new L.Draw.Rectangle(state.map, { shapeOptions: shapeOpts }) },
    { title: t("circle"), svg: svgCirc, create: () => new L.Draw.Circle(state.map, { shapeOptions: shapeOpts }) },
  ];
  let activeShapeBtn = null;
  function resetShapeTool() {
    if (shapeActive) { shapeActive = false; }
    if (activeShapeBtn) {
      activeShapeBtn.style.background = "transparent";
      activeShapeBtn.style.color = "var(--text)";
      activeShapeBtn = null;
    }
  }
  toolDefs.forEach((def) => {
    const btn = document.createElement("button");
    btn.title = def.title;
    btn.innerHTML = def.svg;
    btn.style.cssText =
      "width:28px;height:28px;border:1px solid var(--border);border-radius:4px;background:transparent;" +
      "color:var(--text);cursor:pointer;display:flex;align-items:center;justify-content:center;" +
      "flex-shrink:0;padding:0;";
    btn.onclick = (e) => {
      e.stopPropagation();
      if (shapeActive && activeShapeBtn === btn) { resetShapeTool(); return; }
      resetShapeTool();
      activeShapeBtn = btn;
      btn.style.background = "var(--blue)";
      btn.style.color = "white";
      shapeActive = true;
      const handler = def.create();
      handler.enable();
      handler._freeDrawHandler = handler;
    };
    toolbar.appendChild(btn);
  });

  state.map.getContainer().appendChild(toolbar);

  if (_drawCreatedHandler) state.map.off(L.Draw.Event.CREATED, _drawCreatedHandler);
  if (_drawStopHandler) state.map.off(L.Draw.Event.DRAWSTOP, _drawStopHandler);

  _drawCreatedHandler = (e) => {
    resetShapeTool();
    const l = e.layer, g = l.toGeoJSON();
    if (l instanceof L.Circle) {
      g.properties = g.properties || {};
      g.properties.radius = l.getRadius();
    }
    if (onDoneCb) onDoneCb(g);
  };
  _drawStopHandler = () => resetShapeTool();

  state.map.on(L.Draw.Event.CREATED, _drawCreatedHandler);
  state.map.on(L.Draw.Event.DRAWSTOP, _drawStopHandler);
}

function showToolbar() {
  toolbar.style.display = "flex";
}
function hideToolbar() {
  toolbar.style.display = "none";
  if (widthPopout) widthPopout.style.display = "none";
}

function toggleWidthPopout() {
  if (widthPopout.style.display === "flex") {
    widthPopout.style.display = "none";
  } else {
    const slider = widthPopout.querySelector("input");
    slider.value = state.freeStrokeWidth;
    widthPopout.querySelector("span").textContent = state.freeStrokeWidth;
    widthPopout.style.display = "flex";
  }
}

function updateToolbarSelections() {
  const isPreset = COLORS.includes(state.freeStrokeColor);
  colorDots.forEach((d) => {
    if (d.dataset.color) {
      d.style.border =
        d.dataset.color === state.freeStrokeColor
          ? "2px solid var(--text)"
          : "2px solid transparent";
    } else {
      d.style.border = isPreset ? "2px solid transparent" : "2px solid var(--text)";
    }
  });
  if (hexInput && document.activeElement !== hexInput) {
    hexInput.value = state.freeStrokeColor;
  }
  updateWidthIndicator();
}

function updateWidthIndicator() {
  const w = state.freeStrokeWidth;
  widthBtn.innerHTML = "";
  const dot = document.createElement("span");
  dot.style.cssText =
    "display:inline-block;border-radius:50%;background:var(--text);" +
    `width:${4 + w * 2}px;height:${4 + w * 2}px;`;
  widthBtn.appendChild(dot);
  const slider = widthPopout?.querySelector("input");
  if (slider) slider.value = w;
  const label = widthPopout?.querySelector("span");
  if (label) label.textContent = w;
}

function setColor(color) {
  state.freeStrokeColor = color;
  updateToolbarSelections();
}

function setWidth(width) {
  state.freeStrokeWidth = width;
  updateToolbarSelections();
}

function undo() {
  if (state.freeStrokes.length === 0) return;
  const stroke = state.freeStrokes.pop();
  state.map.removeLayer(stroke.layer);
  state.freeUndoStack.push(stroke);
  navigator.vibrate?.(8);
  playUndo();
}

function redo() {
  if (state.freeUndoStack.length === 0) return;
  const stroke = state.freeUndoStack.pop();
  stroke.layer.addTo(state.map);
  state.freeStrokes.push(stroke);
  navigator.vibrate?.(8);
  playRedo();
}

function detectShape(points) {
  let shape = null;
  try {
    shape = JSON.parse(detect_freehand_shape(JSON.stringify(points)));
  } catch (_) {}
  return shape;
}

function setupPointerEvents() {
  const container = state.map.getContainer();

  container.addEventListener("pointerdown", (e) => {
    if (shapeActive) return;
    if (!state.freeDrawing) return;
    if (e.target.closest("#free-draw-toolbar")) return;
    if (e.target.closest("#free-draw-width-popout")) return;
    if (e.target.closest("button")) return;
    if (pointerId !== null) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    pointerId = e.pointerId;
    container.setPointerCapture(e.pointerId);
    state.freePoints = [];
    const rect = container.getBoundingClientRect();
    const ltln = state.map.containerPointToLatLng([
      e.clientX - rect.left,
      e.clientY - rect.top,
    ]);
    state.freePoints.push([ltln.lng, ltln.lat, e.pressure || 0.5]);
    state.freePreview = L.polyline([[ltln.lat, ltln.lng]], {
      color: state.freeStrokeColor,
      weight: state.freeStrokeWidth,
      opacity: state.highlighting ? 0.35 : 1,
      smoothFactor: 0,
    }).addTo(state.map);
  });

  container.addEventListener("pointermove", (e) => {
    if (!state.freeDrawing || !state.freePreview) return;
    if (e.pointerId !== pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = container.getBoundingClientRect();
    const ltln = state.map.containerPointToLatLng([
      e.clientX - rect.left,
      e.clientY - rect.top,
    ]);
    state.freePoints.push([ltln.lng, ltln.lat, e.pressure || 0.5]);
    state.freePreview.setLatLngs(state.freePoints.map((p) => [p[1], p[0]]));
  });

  container.addEventListener("pointerup", (e) => {
    if (e.pointerId !== pointerId) return;
    container.releasePointerCapture(e.pointerId);
    pointerId = null;
    if (!state.freePreview) return;
    state.map.removeLayer(state.freePreview);
    state.freePreview = null;
    if (state.freePoints.length < 2) {
      state.freePoints = [];
      return;
    }
    let strokeWidth = state.freeStrokeWidth;
    if (!state.highlighting) {
      let avgPressure = 0;
      for (const p of state.freePoints) avgPressure += p[2] || 0.5;
      avgPressure /= state.freePoints.length;
      strokeWidth = Math.max(
        MIN_WIDTH,
        Math.min(MAX_WIDTH, Math.round(state.freeStrokeWidth * avgPressure / 0.5)),
      );
    }
    const positions = state.freePoints.map((p) => [p[0], p[1]]);
    let simplified;
    try {
      const raw = JSON.stringify(positions);
      simplified = JSON.parse(simplify_freehand(raw, 0.00001));
    } catch (_) {
      simplified = positions;
    }
    if (simplified.length < 2) {
      state.freePoints = [];
      return;
    }

    const shape = state.snapping ? detectShape(simplified) : null;
    let layer;
    if (shape && shape.type === "circle") {
      layer = L.circle([shape.center[1], shape.center[0]], {
        radius: shape.radius,
        color: state.freeStrokeColor,
        weight: strokeWidth,
        opacity: state.highlighting ? 0.35 : 1,
        fillColor: state.freeStrokeColor,
        fillOpacity: 0.15,
      }).addTo(state.map);
    } else if (shape && shape.type === "rectangle") {
      layer = L.polygon(
        shape.corners.map((p) => [p[1], p[0]]),
        {
          color: state.freeStrokeColor,
          weight: strokeWidth,
          opacity: state.highlighting ? 0.35 : 1,
          fillColor: state.freeStrokeColor,
          fillOpacity: 0.15,
        },
      ).addTo(state.map);
    } else {
      layer = L.polyline(
        simplified.map((p) => [p[1], p[0]]),
        {
          color: state.freeStrokeColor,
          weight: strokeWidth,
          opacity: state.highlighting ? 0.35 : 1,
          smoothFactor: 0,
        },
      ).addTo(state.map);
    }
    state.freeStrokes.push({
      points: simplified,
      color: state.freeStrokeColor,
      width: strokeWidth,
      opacity: state.highlighting ? 0.35 : 1,
      layer,
      shape: shape || null,
    });
    state.freeUndoStack.length = 0;
    state.freePoints = [];
    navigator.vibrate?.([4, 4, 4]);
    playStroke();
  });

  container.addEventListener("pointercancel", (e) => {
    if (e.pointerId !== pointerId) return;
    container.releasePointerCapture(e.pointerId);
    pointerId = null;
    if (state.freePreview) {
      state.map.removeLayer(state.freePreview);
      state.freePreview = null;
    }
    state.freePoints = [];
  });

  container.addEventListener("pointerleave", (e) => {
    if (e.pointerId !== pointerId) return;
    container.releasePointerCapture(e.pointerId);
    pointerId = null;
    if (state.freePreview) {
      state.map.removeLayer(state.freePreview);
      state.freePreview = null;
    }
    state.freePoints = [];
  });
}
