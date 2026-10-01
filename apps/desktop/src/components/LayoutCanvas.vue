<script setup lang="ts">
import {
  createLayoutCropGeometry,
  flattenLayout,
  rotatedSize,
  type GuideCoordinates,
  type GridPosition,
  type LayoutGrid,
  type PageSizePt,
  type PdfRegionRenderOptions,
  type QuarterTurn,
  type VectorBrushStroke,
  type VectorPoint,
} from "@pdf2plt/core";
import Konva from "konva";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import type { DesktopPdfRegion, PreviewState } from "../stores/pdf-document";
import {
  previewColorTreatment,
  previewInkLayerOpacities,
} from "../stores/preview-appearance";
import {
  canvasPointToWorld,
  canvasLayerTransform,
  canvasCursor,
  canvasRenderPixelRatio,
  fitCameraToContent,
  isCanvasMagnifierShortcut,
  isCanvasPanGesture,
  panCameraBy,
  setCameraZoomAtPoint,
  shouldFitCameraAfterSceneChange,
  wheelPanDelta,
  wheelZoomFactor,
  zoomCameraAtPoint,
  type Camera,
  type Point,
} from "../canvas/camera";
import {
  detailPreviewLongEdge,
  visibleDetailPreviewPages,
} from "../canvas/detail-preview";
import { spacerAppearance } from "../canvas/spacer-appearance";
import {
  adjustMagnifierScale,
  calculateMagnifierFrame,
  calculateMagnifierTiles,
  MAGNIFIER_SCALE,
  magnifierRenderDelay,
  shouldRenderMagnifierAt,
} from "../canvas/magnifier";

Konva.dragButtons = [2];

const props = withDefaults(defineProps<{
  layout: LayoutGrid;
  pageSize: PageSizePt;
  previews: PreviewState[];
  guides: GuideCoordinates | undefined;
  initialCamera: Camera | undefined;
  editable?: boolean;
  showGrid?: boolean;
  foregroundColor?: string;
  backgroundColor?: string;
  lineWeight?: number;
  rotation?: QuarterTurn;
  renderRegion?: (
    pageNumber: number,
    options: PdfRegionRenderOptions,
  ) => Promise<DesktopPdfRegion>;
  brushEnabled?: boolean;
  brushLocked?: boolean;
  brushOperation?: VectorBrushStroke["operation"];
  brushRadiusPt?: number;
  brushStrokes?: readonly VectorBrushStroke[];
  brushSourcePageNumber?: number | undefined;
  selectionOverlays?: PreviewState[];
}>(), {
  editable: true,
  showGrid: true,
  foregroundColor: "#000000",
  backgroundColor: "#ffffff",
  lineWeight: 5,
  rotation: 0,
  brushEnabled: false,
  brushLocked: false,
  brushOperation: "add",
  brushRadiusPt: 12,
  brushStrokes: () => [],
  selectionOverlays: () => [],
});

const emit = defineEmits<{
  zoomChange: [scale: number];
  viewChange: [camera: Camera];
  movePage: [pageNumber: number, target: GridPosition];
  insertSpacer: [target: GridPosition];
  moveSpacer: [spacerId: string, target: GridPosition];
  deleteSpacer: [spacerId: string];
  canvasPreviewRequest: [pageNumbers: number[], maxLongEdge?: number];
  brushStroke: [pageNumber: number, stroke: VectorBrushStroke];
}>();

type DragItem =
  | { kind: "page"; pageNumber: number }
  | { kind: "spacer"; spacerId: string };

interface ActiveDrag {
  group: Konva.Group;
  item: DragItem;
  source: GridPosition;
  target: GridPosition | undefined;
}

const host = ref<HTMLDivElement>();
const stageHost = ref<HTMLDivElement>();
const magnifierCanvas = ref<HTMLCanvasElement>();
let stage: Konva.Stage | undefined;
let contentLayer: Konva.Layer | undefined;
let resizeObserver: ResizeObserver | undefined;
let detailPreviewTimer: number | undefined;
let renderPixelRatio = 2;
let camera: Camera = { x: 0, y: 0, scale: 1 };
let magnifierActive = false;
let magnifierScale = MAGNIFIER_SCALE;
let pointerInside = false;
let magnifierPointer: Point | undefined;
let magnifierAnimationFrame: number | undefined;
let magnifierThrottleTimer: number | undefined;
let magnifierLastRenderStartedAt = Number.NEGATIVE_INFINITY;
let magnifierRenderToken = 0;
let magnifierBusy = false;
let magnifierNeedsRedraw = false;
let magnifierHasFrame = false;
let panning = false;
let lastPointer: Point | undefined;
let activeDrag: ActiveDrag | undefined;
let dropHighlight: Konva.Rect | undefined;
let activeBrushPageNumber: number | undefined;
let activeBrushPoints: VectorPoint[] = [];
let activeBrushLine: Konva.Line | undefined;
interface PreviewImageEntry {
  image: HTMLImageElement;
  loaded: boolean;
  nodes: Set<Konva.Image>;
}

const imageCache = new Map<string, PreviewImageEntry>();
const loadedPreviewImages = new Map<number, HTMLImageElement>();
const geometry = computed(() =>
  createLayoutCropGeometry(props.layout, props.pageSize, props.guides),
);

function updateCursor() {
  if (!host.value) return;
  if (props.brushEnabled) {
    host.value.style.cursor = props.brushLocked
      ? "wait"
      : activeBrushLine ? "crosshair" : "cell";
    return;
  }
  host.value.style.cursor = canvasCursor(
    magnifierActive,
    panning || Boolean(activeDrag),
  );
}

function pagePointAtCanvasPoint(pointer: Point): {
  pageNumber: number;
  pagePoint: VectorPoint;
  worldPoint: Point;
} | undefined {
  const worldPoint = canvasPointToWorld(
    pointer,
    camera,
    getSourceContentSize(),
    props.rotation,
  );
  const column = axisIndex(geometry.value.columns, worldPoint.x);
  const row = axisIndex(geometry.value.rows, worldPoint.y);
  if (row < 0 || column < 0) return undefined;
  const cell = props.layout.cells[row]?.[column];
  if (cell?.kind !== "page") return undefined;
  const frame = frameForCell({ row, column });
  return {
    pageNumber: cell.pageNumber,
    pagePoint: {
      x: Math.max(0, Math.min(props.pageSize.width,
        worldPoint.x - frame.x + frame.sourceX)),
      y: Math.max(0, Math.min(props.pageSize.height,
        worldPoint.y - frame.y + frame.sourceY)),
    },
    worldPoint,
  };
}

function startBrush(pointer: Point | null) {
  if (!pointer || !contentLayer || !props.brushEnabled || props.brushLocked) return;
  const located = pagePointAtCanvasPoint(pointer);
  if (!located) return;
  activeBrushPageNumber = located.pageNumber;
  activeBrushPoints = [located.pagePoint];
  activeBrushLine = new Konva.Line({
    points: [located.worldPoint.x, located.worldPoint.y],
    stroke: props.brushOperation === "add" ? "#e15b35" : "#287c9f",
    strokeWidth: props.brushRadiusPt * 2,
    opacity: 0.34,
    lineCap: "round",
    lineJoin: "round",
    listening: false,
  });
  contentLayer.add(activeBrushLine);
  activeBrushLine.moveToTop();
  contentLayer.batchDraw();
  updateCursor();
}

function appendBrush(pointer: Point | undefined) {
  if (!pointer || !activeBrushLine || !activeBrushPageNumber) return;
  const located = pagePointAtCanvasPoint(pointer);
  if (!located || located.pageNumber !== activeBrushPageNumber) {
    finishBrush(true);
    return;
  }
  const previous = activeBrushPoints.at(-1);
  if (
    previous &&
    Math.hypot(previous.x - located.pagePoint.x, previous.y - located.pagePoint.y) < 0.5
  ) return;
  activeBrushPoints.push(located.pagePoint);
  activeBrushLine.points([
    ...activeBrushLine.points(),
    located.worldPoint.x,
    located.worldPoint.y,
  ]);
  contentLayer?.batchDraw();
}

function finishBrush(commit = true) {
  const pageNumber = activeBrushPageNumber;
  const points = activeBrushPoints;
  activeBrushLine?.destroy();
  activeBrushLine = undefined;
  activeBrushPageNumber = undefined;
  activeBrushPoints = [];
  contentLayer?.batchDraw();
  updateCursor();
  if (!commit || !pageNumber || points.length === 0) return;
  emit("brushStroke", pageNumber, {
    operation: props.brushOperation,
    radiusPt: props.brushRadiusPt,
    points,
  });
}

function hideMagnifier() {
  magnifierRenderToken += 1;
  magnifierNeedsRedraw = false;
  if (magnifierAnimationFrame !== undefined) {
    cancelAnimationFrame(magnifierAnimationFrame);
    magnifierAnimationFrame = undefined;
  }
  if (magnifierThrottleTimer !== undefined) {
    window.clearTimeout(magnifierThrottleTimer);
    magnifierThrottleTimer = undefined;
  }
  if (magnifierCanvas.value) magnifierCanvas.value.hidden = true;
}

function decodeRegionImage(bytes: Uint8Array<ArrayBuffer>): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    const image = new window.Image();
    image.decoding = "async";
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法解码局部放大图像。"));
    };
    image.src = url;
  });
}

function drawMagnifierLabel(
  context: CanvasRenderingContext2D,
  width: number,
) {
  const scaleLabel = `${magnifierScale.toFixed(2)}×`;
  context.font = "600 12px system-ui, sans-serif";
  const labelWidth = Math.ceil(context.measureText(scaleLabel).width) + 14;
  context.fillStyle = "rgb(15 23 28 / 78%)";
  context.fillRect(width - labelWidth - 8, 8, labelWidth, 24);
  context.fillStyle = "#eef7fa";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(scaleLabel, width - labelWidth / 2 - 8, 20);
}

function drawRegionTile(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  target: { x: number; y: number; width: number; height: number },
) {
  const colorTreatment = previewColorTreatment(
    props.foregroundColor,
    props.backgroundColor,
  );
  context.save();
  context.beginPath();
  context.rect(target.x, target.y, target.width, target.height);
  context.clip();
  context.translate(target.x, target.y);
  if (props.rotation === 90) {
    context.translate(target.width, 0);
    context.rotate(Math.PI / 2);
  } else if (props.rotation === 180) {
    context.translate(target.width, target.height);
    context.rotate(Math.PI);
  } else if (props.rotation === 270) {
    context.translate(0, target.height);
    context.rotate((Math.PI * 3) / 2);
  }
  const drawSize = rotatedSize(target, props.rotation);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, drawSize.width, drawSize.height);
  for (const opacity of previewInkLayerOpacities(props.lineWeight)) {
    context.globalCompositeOperation = "multiply";
    context.globalAlpha = opacity;
    context.drawImage(image, 0, 0, drawSize.width, drawSize.height);
  }
  context.globalAlpha = 1;
  if (colorTreatment.mode !== "source") {
    context.globalCompositeOperation = "color";
    context.fillStyle = "#808080";
    context.fillRect(0, 0, drawSize.width, drawSize.height);
    if (colorTreatment.mode === "dark-background") {
      context.globalCompositeOperation = "difference";
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, drawSize.width, drawSize.height);
    }
    context.globalCompositeOperation = colorTreatment.mode === "dark-background"
      ? "multiply"
      : "screen";
    context.fillStyle = colorTreatment.compositeForegroundColor;
    context.fillRect(0, 0, drawSize.width, drawSize.height);
    context.globalCompositeOperation = colorTreatment.mode === "dark-background"
      ? "screen"
      : "multiply";
    context.fillStyle = props.backgroundColor;
    context.fillRect(0, 0, drawSize.width, drawSize.height);
  }
  context.restore();
}

async function renderVectorMagnifier() {
  const canvas = magnifierCanvas.value;
  const pointer = magnifierPointer;
  if (!magnifierActive || !pointerInside || !stage || !canvas || !pointer || !props.renderRegion) {
    hideMagnifier();
    return;
  }
  const token = ++magnifierRenderToken;
  const frame = calculateMagnifierFrame(
    pointer,
    { width: stage.width(), height: stage.height() },
    undefined,
    magnifierScale,
  );
  const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
  const outputWidth = Math.max(1, Math.round(frame.lens.width * pixelRatio));
  const outputHeight = Math.max(1, Math.round(frame.lens.height * pixelRatio));
  const sizeChanged = canvas.width !== outputWidth || canvas.height !== outputHeight;
  if (sizeChanged) {
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    magnifierHasFrame = false;
  }
  canvas.style.left = `${frame.lens.x}px`;
  canvas.style.top = `${frame.lens.y}px`;
  canvas.style.width = `${frame.lens.width}px`;
  canvas.style.height = `${frame.lens.height}px`;
  const liveContext = canvas.getContext("2d");
  if (!liveContext) {
    hideMagnifier();
    return;
  }
  if (!magnifierHasFrame) {
    liveContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    liveContext.fillStyle = "#d7d2c9";
    liveContext.fillRect(0, 0, frame.lens.width, frame.lens.height);
    drawMagnifierLabel(liveContext, frame.lens.width);
  }
  canvas.hidden = false;

  const renderCanvas = document.createElement("canvas");
  renderCanvas.width = outputWidth;
  renderCanvas.height = outputHeight;
  const context = renderCanvas.getContext("2d");
  if (!context) return;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.fillStyle = "#d7d2c9";
  context.fillRect(0, 0, frame.lens.width, frame.lens.height);

  const pages = [];
  for (let row = 0; row < props.layout.rows; row += 1) {
    for (let column = 0; column < props.layout.columns; column += 1) {
      const cell = props.layout.cells[row]?.[column];
      if (cell?.kind !== "page") continue;
      pages.push({ pageNumber: cell.pageNumber, ...frameForCell({ row, column }) });
    }
  }
  const tiles = calculateMagnifierTiles(
    frame.source,
    magnifierScale,
    camera,
    getSourceContentSize(),
    pages,
    props.rotation,
  );
  try {
    const rendered = await Promise.all(tiles.map(async (tile) => {
      const outputSize = rotatedSize(tile.target, props.rotation);
      const region = await props.renderRegion!(tile.pageNumber, {
        ...tile.source,
        outputWidth: Math.max(1, Math.round(outputSize.width * pixelRatio)),
        outputHeight: Math.max(1, Math.round(outputSize.height * pixelRatio)),
      });
      return { tile, image: await decodeRegionImage(region.bytes) };
    }));
    if (token !== magnifierRenderToken || !magnifierActive) return;
    for (const { tile, image } of rendered) {
      drawRegionTile(context, image, tile.target);
    }
    drawMagnifierLabel(context, frame.lens.width);
    liveContext.setTransform(1, 0, 0, 1, 0, 0);
    liveContext.clearRect(0, 0, canvas.width, canvas.height);
    liveContext.drawImage(renderCanvas, 0, 0);
    magnifierHasFrame = true;
  } catch {
    if (token !== magnifierRenderToken) return;
    if (!magnifierHasFrame) {
      liveContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      liveContext.fillStyle = "#6f1f24";
      liveContext.font = "13px system-ui, sans-serif";
      liveContext.textAlign = "center";
      liveContext.textBaseline = "middle";
      liveContext.fillText(
        "局部矢量重绘失败",
        frame.lens.width / 2,
        frame.lens.height / 2,
      );
      drawMagnifierLabel(liveContext, frame.lens.width);
    }
  }
}

function drawMagnifier() {
  magnifierAnimationFrame = undefined;
  if (!magnifierActive || !pointerInside) {
    hideMagnifier();
    return;
  }
  if (magnifierBusy) {
    magnifierNeedsRedraw = true;
    return;
  }
  magnifierLastRenderStartedAt = performance.now();
  magnifierBusy = true;
  magnifierNeedsRedraw = false;
  void renderVectorMagnifier().finally(() => {
    magnifierBusy = false;
    if (magnifierNeedsRedraw && magnifierActive && pointerInside) {
      scheduleMagnifier(undefined, true);
    }
  });
}

function queueMagnifierDraw() {
  if (
    magnifierAnimationFrame !== undefined ||
    magnifierThrottleTimer !== undefined
  ) {
    return;
  }
  const delay = magnifierRenderDelay(
    magnifierLastRenderStartedAt,
    performance.now(),
  );
  if (delay > 0) {
    magnifierThrottleTimer = window.setTimeout(() => {
      magnifierThrottleTimer = undefined;
      if (!magnifierActive || !pointerInside) return;
      magnifierAnimationFrame = requestAnimationFrame(drawMagnifier);
    }, delay);
    return;
  }
  magnifierAnimationFrame = requestAnimationFrame(drawMagnifier);
}

function scheduleMagnifier(
  pointer = stage?.getPointerPosition() ?? undefined,
  force = false,
) {
  const shouldRender = shouldRenderMagnifierAt(magnifierPointer, pointer, force);
  if (pointer) magnifierPointer = pointer;
  if (!shouldRender) return;
  if (!magnifierActive || !pointerInside) return;
  if (magnifierBusy) {
    magnifierNeedsRedraw = true;
    return;
  }
  queueMagnifierDraw();
}

function applyCamera(nextCamera: Camera) {
  camera = nextCamera;
  if (host.value) {
    host.value.dataset.cameraX = String(camera.x);
    host.value.dataset.cameraY = String(camera.y);
    host.value.dataset.cameraScale = String(camera.scale);
  }
  const transform = canvasLayerTransform(
    camera,
    getSourceContentSize(),
    props.rotation,
  );
  contentLayer?.position({ x: transform.x, y: transform.y });
  contentLayer?.scale({ x: transform.scaleX, y: transform.scaleY });
  contentLayer?.rotation(transform.rotation);
  contentLayer?.batchDraw();
  scheduleDetailPreview();
  emit("zoomChange", camera.scale);
  emit("viewChange", { ...camera });
}

function getSourceContentSize() {
  return {
    width: geometry.value.width,
    height: geometry.value.height,
  };
}

function getDisplayContentSize() {
  return rotatedSize(getSourceContentSize(), props.rotation);
}

function requestCanvasPreviews() {
  detailPreviewTimer = undefined;
  if (!stage) return;
  const maxLongEdge = detailPreviewLongEdge(
    props.pageSize,
    camera.scale,
    renderPixelRatio,
  );
  const pages = [];
  for (let row = 0; row < props.layout.rows; row += 1) {
    for (let column = 0; column < props.layout.columns; column += 1) {
      const cell = props.layout.cells[row]?.[column];
      if (cell?.kind !== "page") continue;
      pages.push({ pageNumber: cell.pageNumber, ...frameForCell({ row, column }) });
    }
  }
  const visiblePages = visibleDetailPreviewPages(
    camera,
    { width: stage.width(), height: stage.height() },
    getSourceContentSize(),
    props.rotation,
    pages,
  );
  if (visiblePages.length > 0) {
    emit("canvasPreviewRequest", visiblePages, maxLongEdge);
  }
}

function scheduleDetailPreview() {
  if (detailPreviewTimer !== undefined) window.clearTimeout(detailPreviewTimer);
  detailPreviewTimer = window.setTimeout(requestCanvasPreviews, 120);
}

function fitContent() {
  if (!stage) return;
  const content = getDisplayContentSize();
  applyCamera(
    fitCameraToContent(
      { width: stage.width(), height: stage.height() },
      { x: 0, y: 0, ...content },
    ),
  );
}

function setZoom(scale: number) {
  if (!stage || !Number.isFinite(scale)) return;
  const viewportCenter = {
    x: stage.width() / 2,
    y: stage.height() / 2,
  };
  applyCamera(setCameraZoomAtPoint(camera, viewportCenter, scale));
}

function loadPreview(url: string, pageNumber: number, node: Konva.Image) {
  const cached = imageCache.get(url);
  if (cached) {
    cached.nodes.add(node);
    node.image(
      cached.loaded
        ? cached.image
        : loadedPreviewImages.get(pageNumber) ?? cached.image,
    );
    if (cached.loaded) node.getLayer()?.batchDraw();
    return;
  }

  const image = new window.Image();
  image.decoding = "async";
  const entry: PreviewImageEntry = { image, loaded: false, nodes: new Set([node]) };
  imageCache.set(url, entry);
  node.image(loadedPreviewImages.get(pageNumber) ?? image);
  image.onload = () => {
    if (imageCache.get(url) !== entry) return;
    entry.loaded = true;
    loadedPreviewImages.set(pageNumber, image);
    for (const waitingNode of entry.nodes) {
      if (waitingNode.getLayer()) {
        waitingNode.image(image);
        waitingNode.getLayer()?.batchDraw();
      } else {
        entry.nodes.delete(waitingNode);
      }
    }
  };
  image.onerror = () => {
    if (imageCache.get(url) === entry) imageCache.delete(url);
  };
  image.src = url;
}

interface CellFrame extends Point {
  width: number;
  height: number;
  sourceX: number;
  sourceY: number;
}

function frameForCell(position: GridPosition): CellFrame {
  const column = geometry.value.columns[position.column];
  const row = geometry.value.rows[position.row];
  if (!column || !row) {
    return { x: 0, y: 0, width: 0, height: 0, sourceX: 0, sourceY: 0 };
  }
  return {
    x: column.outputStart,
    y: row.outputStart,
    width: column.size,
    height: row.size,
    sourceX: column.sourceStart,
    sourceY: row.sourceStart,
  };
}

function positionForCell(position: GridPosition): Point {
  const frame = frameForCell(position);
  return { x: frame.x, y: frame.y };
}

function axisIndex(
  segments: readonly { outputStart: number; size: number }[],
  coordinate: number,
): number {
  return segments.findIndex(
    (segment) => coordinate >= segment.outputStart && coordinate < segment.outputStart + segment.size,
  );
}

function getDragTarget(group: Konva.Group): GridPosition | undefined {
  const column = axisIndex(geometry.value.columns, group.x() + group.width() / 2);
  const row = axisIndex(geometry.value.rows, group.y() + group.height() / 2);
  if (
    row < 0 ||
    row >= props.layout.rows ||
    column < 0 ||
    column >= props.layout.columns
  ) {
    return undefined;
  }
  return { row, column };
}

function showDropTarget(target?: GridPosition) {
  if (!dropHighlight || !target) {
    if (host.value) {
      delete host.value.dataset.dropRow;
      delete host.value.dataset.dropColumn;
    }
    dropHighlight?.hide();
    contentLayer?.batchDraw();
    return;
  }
  if (host.value) {
    host.value.dataset.dropRow = String(target.row);
    host.value.dataset.dropColumn = String(target.column);
  }
  dropHighlight.position(positionForCell(target));
  const frame = frameForCell(target);
  dropHighlight.size({ width: frame.width, height: frame.height });
  dropHighlight.show();
  dropHighlight.moveToTop();
  contentLayer?.batchDraw();
}

function restoreDraggedGroup(drag: ActiveDrag) {
  if (host.value) {
    delete host.value.dataset.draggingPage;
    delete host.value.dataset.draggingSpacer;
  }
  drag.group.position(positionForCell(drag.source));
  drag.group.opacity(1);
  showDropTarget();
  updateCursor();
  contentLayer?.batchDraw();
}

function bindCellDrag(group: Konva.Group, item: DragItem, source: GridPosition) {
  group.on("mouseenter", updateCursor);
  group.on("mouseleave", updateCursor);
  group.on("dragstart", () => {
    activeDrag = { group, item, source, target: undefined };
    if (host.value) {
      if (item.kind === "page") {
        host.value.dataset.draggingPage = String(item.pageNumber);
      } else {
        host.value.dataset.draggingSpacer = item.spacerId;
      }
    }
    group.opacity(0.78);
    group.moveToTop();
    updateCursor();
  });
  group.on("dragmove", () => {
    if (!activeDrag || activeDrag.group !== group) return;
    activeDrag.target = getDragTarget(group);
    showDropTarget(activeDrag.target);
  });
  group.on("dragend", () => {
    const drag = activeDrag;
    activeDrag = undefined;
    if (!drag || drag.group !== group || !drag.target) {
      restoreDraggedGroup({ group, item, source, target: undefined });
      return;
    }

    group.position(positionForCell(drag.target));
    group.opacity(1);
    if (host.value) {
      delete host.value.dataset.draggingPage;
      delete host.value.dataset.draggingSpacer;
    }
    showDropTarget();
    updateCursor();
    if (item.kind === "page") {
      emit("movePage", item.pageNumber, drag.target);
    } else {
      emit("moveSpacer", item.spacerId, drag.target);
    }
  });
}

function cancelActiveDrag() {
  const drag = activeDrag;
  if (!drag) return;
  activeDrag = undefined;
  drag.group.stopDrag();
  restoreDraggedGroup(drag);
}

function createPageGroup(
  pageNumber: number,
  source: GridPosition,
  preview?: PreviewState,
  selectionOverlay?: PreviewState,
): Konva.Group {
  const frame = frameForCell(source);
  const group = new Konva.Group({
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    clipX: 0,
    clipY: 0,
    clipWidth: frame.width,
    clipHeight: frame.height,
    draggable: props.editable && !props.brushEnabled,
    name: "layout-item layout-page",
  });
  group.setAttr("pageNumber", pageNumber);
  group.add(
    new Konva.Rect({
      width: frame.width,
      height: frame.height,
      fill: preview ? "#ffffff" : props.backgroundColor,
    }),
  );

  if (preview) {
    const colorTreatment = previewColorTreatment(
      props.foregroundColor,
      props.backgroundColor,
    );
    const cachedImage = imageCache.get(preview.url)?.image ?? new window.Image();
    const imagePosition = {
      x: -frame.sourceX,
      y: -frame.sourceY,
      width: props.pageSize.width,
      height: props.pageSize.height,
    };
    for (const opacity of previewInkLayerOpacities(props.lineWeight)) {
      const previewNode = new Konva.Image({
        ...imagePosition,
        image: cachedImage,
        globalCompositeOperation: "multiply",
        opacity,
        listening: false,
      });
      loadPreview(preview.url, pageNumber, previewNode);
      group.add(previewNode);
    }
    if (colorTreatment.mode !== "source") {
      group.add(
        new Konva.Rect({
          width: frame.width,
          height: frame.height,
          fill: "#808080",
          globalCompositeOperation: "color",
          listening: false,
        }),
        ...(colorTreatment.mode === "dark-background"
          ? [
              new Konva.Rect({
                width: frame.width,
                height: frame.height,
                fill: "#ffffff",
                globalCompositeOperation: "difference",
                listening: false,
              }),
            ]
          : []),
        new Konva.Rect({
          width: frame.width,
          height: frame.height,
          fill: colorTreatment.compositeForegroundColor,
          globalCompositeOperation:
            colorTreatment.mode === "dark-background" ? "multiply" : "screen",
          listening: false,
        }),
        new Konva.Rect({
          width: frame.width,
          height: frame.height,
          fill: props.backgroundColor,
          globalCompositeOperation:
            colorTreatment.mode === "dark-background" ? "screen" : "multiply",
          listening: false,
        }),
      );
    }
  }

  if (selectionOverlay) {
    const image = new window.Image();
    image.decoding = "async";
    const overlayNode = new Konva.Image({
      x: -frame.sourceX,
      y: -frame.sourceY,
      width: props.pageSize.width,
      height: props.pageSize.height,
      image,
      opacity: 0.9,
      listening: false,
    });
    image.onload = () => overlayNode.getLayer()?.batchDraw();
    image.src = selectionOverlay.url;
    group.add(overlayNode);
  }

  if (pageNumber === props.brushSourcePageNumber) {
    for (const stroke of props.brushStrokes) {
      group.add(new Konva.Line({
        points: stroke.points.flatMap((point) => [
          point.x - frame.sourceX,
          point.y - frame.sourceY,
        ]),
        stroke: stroke.operation === "add" ? "#e15b35" : "#287c9f",
        strokeWidth: stroke.radiusPt * 2,
        opacity: 0.2,
        lineCap: "round",
        lineJoin: "round",
        ...(stroke.operation === "subtract" ? { dash: [8, 5] } : {}),
        listening: false,
      }));
    }
  }

  if (props.showGrid) {
    group.add(
      new Konva.Rect({
        width: frame.width,
        height: frame.height,
        stroke: "#69655e",
        strokeWidth: 1.25,
        strokeScaleEnabled: false,
        listening: false,
      }),
    );
    group.add(
      new Konva.Label({ x: 18, y: 18, listening: false })
        .add(
          new Konva.Tag({
            fill: "#315f64",
            opacity: 0.94,
            cornerRadius: 8,
          }),
        )
        .add(
          new Konva.Text({
            text: `${pageNumber}`,
            fill: "#fffdf8",
            fontSize: 30,
            fontStyle: "bold",
            padding: 11,
          }),
        ),
    );
  }

  if (props.editable && !props.brushEnabled) {
    bindCellDrag(group, { kind: "page", pageNumber }, source);
  }

  return group;
}

function createSpacerGroup(spacerId: string, source: GridPosition): Konva.Group {
  const frame = frameForCell(source);
  const appearance = spacerAppearance(props.backgroundColor);
  const group = new Konva.Group({
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    clipX: 0,
    clipY: 0,
    clipWidth: frame.width,
    clipHeight: frame.height,
    draggable: props.editable && !props.brushEnabled,
    name: "layout-item layout-spacer",
  });
  group.add(
    new Konva.Rect({
      width: frame.width,
      height: frame.height,
      fill: props.backgroundColor,
      strokeScaleEnabled: false,
      name: "spacer-hit-area",
    }),
  );
  const wash = new Konva.Rect({
    width: frame.width,
    height: frame.height,
    fill: appearance.accentColor,
    opacity: appearance.washOpacity,
    listening: false,
    name: "spacer-wash",
  });
  group.add(wash);

  const hatchSpacing = 56;
  const hatching = new Konva.Shape({
    width: frame.width,
    height: frame.height,
    stroke: appearance.accentColor,
    strokeWidth: 1,
    strokeScaleEnabled: false,
    opacity: appearance.hatchOpacity,
    listening: false,
    name: "spacer-hatching",
    sceneFunc: (context, shape) => {
      context.beginPath();
      for (
        let offset = -frame.height;
        offset <= frame.width;
        offset += hatchSpacing
      ) {
        context.moveTo(offset, frame.height);
        context.lineTo(offset + frame.height, 0);
      }
      context.fillStrokeShape(shape);
    },
  });
  group.add(hatching);

  const inset = Math.max(4, Math.min(10, frame.width * 0.04, frame.height * 0.04));
  const border = new Konva.Rect({
    x: inset,
    y: inset,
    width: Math.max(0, frame.width - inset * 2),
    height: Math.max(0, frame.height - inset * 2),
    cornerRadius: 7,
    stroke: appearance.accentColor,
    strokeWidth: 1.5,
    strokeScaleEnabled: false,
    dash: [11, 9],
    opacity: appearance.borderOpacity,
    listening: false,
    name: "spacer-border",
  });
  group.add(border);

  const setEmphasized = (emphasized: boolean) => {
    wash.opacity(appearance.washOpacity * (emphasized ? 2 : 1));
    hatching.opacity(appearance.hatchOpacity * (emphasized ? 1.45 : 1));
    border.opacity(Math.min(1, appearance.borderOpacity * (emphasized ? 1.45 : 1)));
    border.strokeWidth(emphasized ? 2.25 : 1.5);
    group.getLayer()?.batchDraw();
  };
  group.on("mouseenter", () => setEmphasized(true));
  group.on("mouseleave", () => {
    if (activeDrag?.group !== group) setEmphasized(false);
  });
  group.on("dragstart", () => setEmphasized(true));
  group.on("dragend", () => setEmphasized(false));

  if (props.editable && !props.brushEnabled) {
    group.on("dblclick dbltap", () => emit("deleteSpacer", spacerId));
    bindCellDrag(group, { kind: "spacer", spacerId }, source);
  }
  return group;
}

function positionFromClient(clientX: number, clientY: number): GridPosition | undefined {
  if (!host.value) return undefined;
  const bounds = host.value.getBoundingClientRect();
  const world = canvasPointToWorld(
    { x: clientX - bounds.left, y: clientY - bounds.top },
    camera,
    getSourceContentSize(),
    props.rotation,
  );
  const worldX = world.x;
  const worldY = world.y;
  const column = axisIndex(geometry.value.columns, worldX);
  const row = axisIndex(geometry.value.rows, worldY);
  if (
    row < 0 ||
    row >= props.layout.rows ||
    column < 0 ||
    column >= props.layout.columns
  ) {
    return undefined;
  }
  return { row, column };
}

function handleExternalDragOver(event: DragEvent) {
  if (!props.editable || props.brushEnabled) return;
  if (!event.dataTransfer?.types.includes("application/x-pdf2plt-spacer")) return;
  event.dataTransfer.dropEffect = "copy";
  showDropTarget(positionFromClient(event.clientX, event.clientY));
}

function handleExternalDragLeave(event: DragEvent) {
  if (!props.editable || props.brushEnabled) return;
  const related = event.relatedTarget;
  if (related instanceof Node && host.value?.contains(related)) return;
  showDropTarget();
}

function handleExternalDrop(event: DragEvent) {
  if (!props.editable || props.brushEnabled) return;
  if (!event.dataTransfer?.types.includes("application/x-pdf2plt-spacer")) return;
  const target = positionFromClient(event.clientX, event.clientY);
  showDropTarget();
  if (target) emit("insertSpacer", target);
}

function renderScene() {
  if (!contentLayer) return;
  activeDrag = undefined;
  dropHighlight = undefined;
  contentLayer.destroyChildren();
  const activePreviewUrls = new Set(props.previews.map((preview) => preview.url));
  for (const url of imageCache.keys()) {
    if (!activePreviewUrls.has(url)) imageCache.delete(url);
  }
  const previewByPage = new Map(
    props.previews.map((preview) => [preview.pageNumber, preview]),
  );
  const selectionOverlayByPage = new Map(
    props.selectionOverlays.map((preview) => [preview.pageNumber, preview]),
  );
  if (host.value) {
    host.value.dataset.layoutCells = flattenLayout(props.layout)
      .map((cell) =>
        cell?.kind === "page" ? cell.pageNumber : cell?.kind === "spacer" ? "S" : "-",
      )
      .join(",");
    host.value.dataset.pageWidth = String(props.pageSize.width);
    host.value.dataset.pageHeight = String(props.pageSize.height);
    host.value.dataset.layoutRows = String(props.layout.rows);
    host.value.dataset.layoutColumns = String(props.layout.columns);
    host.value.dataset.previewMode = props.guides ? "cropped" : "full";
    host.value.dataset.editable = String(props.editable);
    host.value.dataset.showGrid = String(props.showGrid);
    host.value.dataset.contentWidth = String(geometry.value.width);
    host.value.dataset.contentHeight = String(geometry.value.height);
  }

  for (let row = 0; row < props.layout.rows; row += 1) {
    for (let column = 0; column < props.layout.columns; column += 1) {
      const cell = props.layout.cells[row]?.[column];
      const frame = frameForCell({ row, column });

      contentLayer.add(
        new Konva.Rect({
          x: frame.x,
          y: frame.y,
          width: frame.width,
          height: frame.height,
          fill: cell ? props.backgroundColor : "#d7d2c9",
          ...(cell && props.showGrid
            ? {
                shadowColor: "#5d574f",
                shadowBlur: 7,
                shadowOpacity: 0.16,
                shadowOffset: { x: 0, y: 2 },
              }
            : {}),
          strokeScaleEnabled: false,
          ...(props.showGrid
            ? {
                stroke: cell ? "#777168" : "#b7b0a5",
                strokeWidth: 1,
                ...(cell ? {} : { dash: [10, 8] }),
              }
            : { strokeWidth: 0 }),
        }),
      );

      if (cell?.kind === "page") {
        contentLayer.add(
          createPageGroup(
            cell.pageNumber,
            { row, column },
            previewByPage.get(cell.pageNumber),
            selectionOverlayByPage.get(cell.pageNumber),
          ),
        );
      } else if (cell?.kind === "spacer") {
        contentLayer.add(createSpacerGroup(cell.spacerId, { row, column }));
      }
    }
  }

  dropHighlight = new Konva.Rect({
    width: geometry.value.columns[0]?.size ?? props.pageSize.width,
    height: geometry.value.rows[0]?.size ?? props.pageSize.height,
    fill: "#4e8b90",
    opacity: 0.22,
    stroke: "#2f6f75",
    strokeWidth: 3,
    strokeScaleEnabled: false,
    listening: false,
    visible: false,
  });
  contentLayer.add(dropHighlight);

  contentLayer.batchDraw();
}

function resizeStage() {
  if (!stage || !host.value) return;
  const width = Math.max(1, host.value.clientWidth);
  const height = Math.max(1, host.value.clientHeight);
  stage.size({ width, height });
  stage.batchDraw();
}

function startPan(pointer: Point | null) {
  if (!pointer || !stage) return;
  panning = true;
  lastPointer = pointer;
  updateCursor();
}

function stopPan() {
  panning = false;
  lastPointer = undefined;
  updateCursor();
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.code === "Escape" && activeBrushLine) {
    event.preventDefault();
    finishBrush(false);
    return;
  }
  if (isCanvasMagnifierShortcut(
    event.code,
    pointerInside,
    document.activeElement === host.value,
  )) {
    event.preventDefault();
    if (magnifierActive) return;
    magnifierActive = true;
    updateCursor();
    scheduleMagnifier(stage?.getPointerPosition() ?? undefined, true);
    return;
  }
  if (event.code === "Escape" && activeDrag) {
    event.preventDefault();
    cancelActiveDrag();
  }
}

function handleKeyUp(event: KeyboardEvent) {
  if (event.code !== "Space" || !magnifierActive) return;
  event.preventDefault();
  magnifierActive = false;
  hideMagnifier();
  updateCursor();
}

function handleBlur() {
  magnifierActive = false;
  hideMagnifier();
  stopPan();
}

onMounted(() => {
  if (!host.value || !stageHost.value) return;
  renderPixelRatio = canvasRenderPixelRatio(window.devicePixelRatio || 1);
  Konva.pixelRatio = renderPixelRatio;
  host.value.dataset.renderPixelRatio = String(renderPixelRatio);
  stage = new Konva.Stage({ container: stageHost.value, width: 1, height: 1 });
  updateCursor();
  contentLayer = new Konva.Layer({ imageSmoothingEnabled: true });
  stage.add(contentLayer);
  resizeStage();
  renderScene();
  if (props.initialCamera) applyCamera({ ...props.initialCamera });
  else fitContent();

  stage.on("wheel", (event) => {
    event.evt.preventDefault();
    if (magnifierActive) {
      magnifierScale = adjustMagnifierScale(
        magnifierScale,
        event.evt.deltaY,
        event.evt.shiftKey,
      );
      if (host.value) host.value.dataset.magnifierScale = magnifierScale.toFixed(2);
      scheduleMagnifier(stage?.getPointerPosition() ?? undefined, true);
      return;
    }
    if (event.evt.ctrlKey) {
      const pointer = stage?.getPointerPosition() ?? {
        x: (stage?.width() ?? 0) / 2,
        y: (stage?.height() ?? 0) / 2,
      };
      applyCamera(
        zoomCameraAtPoint(
          camera,
          pointer,
          wheelZoomFactor(event.evt.deltaY, event.evt.shiftKey),
        ),
      );
      return;
    }
    applyCamera(
      panCameraBy(
        camera,
        wheelPanDelta(event.evt.deltaX, event.evt.deltaY, event.evt.shiftKey),
      ),
    );
  });
  stage.on("mousedown", (event) => {
    host.value?.focus();
    const button = event.evt.button;
    if (props.brushEnabled && button === 0) {
      event.evt.preventDefault();
      startBrush(stage?.getPointerPosition() ?? null);
      return;
    }
    if (isCanvasPanGesture(button)) {
      event.evt.preventDefault();
      startPan(stage?.getPointerPosition() ?? null);
    }
  });
  stage.on("contextmenu", (event) => {
    event.evt.preventDefault();
  });
  stage.on("mousemove", () => {
    const pointer = stage?.getPointerPosition();
    if (activeBrushLine) {
      appendBrush(pointer ?? undefined);
      return;
    }
    if (pointer) scheduleMagnifier(pointer);
    if (!panning || !pointer || !lastPointer) return;
    applyCamera(
      panCameraBy(camera, {
        x: pointer.x - lastPointer.x,
        y: pointer.y - lastPointer.y,
      }),
    );
    lastPointer = pointer;
  });
  stage.on("mouseup", () => {
    if (activeBrushLine) finishBrush(true);
    else stopPan();
  });
  stage.on("mouseenter", () => {
    pointerInside = true;
    updateCursor();
  });
  stage.on("mouseleave", () => {
    pointerInside = false;
    hideMagnifier();
    if (activeBrushLine) finishBrush(true);
    stopPan();
  });

  resizeObserver = new ResizeObserver(() => resizeStage());
  resizeObserver.observe(host.value);
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  window.addEventListener("blur", handleBlur);
});

watch(
  () => [
    props.layout,
    props.pageSize,
    props.previews,
    props.guides,
    props.showGrid,
    props.foregroundColor,
    props.backgroundColor,
    props.lineWeight,
    props.rotation,
    props.brushEnabled,
    props.brushLocked,
    props.brushOperation,
    props.brushRadiusPt,
    props.brushStrokes,
    props.brushSourcePageNumber,
    props.selectionOverlays,
  ] as const,
  async (values, previousValues) => {
    const layout = values[0];
    const pageSize = values[1];
    const guides = values[3];
    const rotation = values[8];
    const previousLayout = previousValues[0];
    const previousPageSize = previousValues[1];
    const previousGuides = previousValues[3];
    const previousRotation = previousValues[8];
    if ((!values[9] || values[10]) && activeBrushLine) finishBrush(false);
    renderScene();
    applyCamera(camera);
    if (shouldFitCameraAfterSceneChange(
      {
        rows: layout.rows,
        columns: layout.columns,
        guides,
        rotation,
        pageWidth: pageSize.width,
        pageHeight: pageSize.height,
      },
      {
        rows: previousLayout.rows,
        columns: previousLayout.columns,
        guides: previousGuides,
        rotation: previousRotation,
        pageWidth: previousPageSize.width,
        pageHeight: previousPageSize.height,
      },
    )) {
      await nextTick();
      fitContent();
    }
    if (rotation !== previousRotation) scheduleMagnifier(undefined, true);
  },
  { deep: true },
);

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  if (detailPreviewTimer !== undefined) window.clearTimeout(detailPreviewTimer);
  hideMagnifier();
  finishBrush(false);
  window.removeEventListener("keydown", handleKeyDown);
  window.removeEventListener("keyup", handleKeyUp);
  window.removeEventListener("blur", handleBlur);
  stage?.destroy();
  imageCache.clear();
  loadedPreviewImages.clear();
});

defineExpose({ fitContent, setZoom });
</script>

<template>
  <div
    ref="host"
    class="layout-canvas"
    tabindex="0"
    :aria-label="props.editable ? 'PDF 自动排版画板' : 'PDF 全屏只读预览画板'"
    @blur="handleBlur"
    @dragover.prevent="handleExternalDragOver"
    @dragleave="handleExternalDragLeave"
    @drop.prevent="handleExternalDrop"
  >
    <div ref="stageHost" class="layout-canvas__stage" />
    <canvas
      ref="magnifierCanvas"
      class="layout-canvas__magnifier"
      aria-hidden="true"
      hidden
    />
  </div>
</template>
