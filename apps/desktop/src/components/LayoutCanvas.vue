<script setup lang="ts">
import {
  createLayoutCropGeometry,
  flattenLayout,
  type GuideCoordinates,
  type GridPosition,
  type LayoutGrid,
  type PageSizePt,
} from "@pdf2plt/core";
import Konva from "konva";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import type { PreviewState } from "../stores/pdf-document";
import {
  previewColorTreatment,
  previewInkLayerOpacities,
} from "../stores/preview-appearance";
import {
  fitCameraToContent,
  isCanvasPanGesture,
  panCameraBy,
  setCameraZoomAtPoint,
  zoomCameraAtPoint,
  type Camera,
  type Point,
} from "../canvas/camera";

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
}>(), {
  editable: true,
  showGrid: true,
  foregroundColor: "#000000",
  backgroundColor: "#ffffff",
  lineWeight: 2,
});

const emit = defineEmits<{
  zoomChange: [scale: number];
  viewChange: [camera: Camera];
  movePage: [pageNumber: number, target: GridPosition];
  insertSpacer: [target: GridPosition];
  moveSpacer: [spacerId: string, target: GridPosition];
  deleteSpacer: [spacerId: string];
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
let stage: Konva.Stage | undefined;
let contentLayer: Konva.Layer | undefined;
let resizeObserver: ResizeObserver | undefined;
let camera: Camera = { x: 0, y: 0, scale: 1 };
let spacePressed = false;
let pointerInside = false;
let panning = false;
let lastPointer: Point | undefined;
let activeDrag: ActiveDrag | undefined;
let dropHighlight: Konva.Rect | undefined;
interface PreviewImageEntry {
  image: HTMLImageElement;
  loaded: boolean;
  nodes: Set<Konva.Image>;
}

const imageCache = new Map<string, PreviewImageEntry>();
const geometry = computed(() =>
  createLayoutCropGeometry(props.layout, props.pageSize, props.guides),
);

function applyCamera(nextCamera: Camera) {
  camera = nextCamera;
  if (host.value) {
    host.value.dataset.cameraX = String(camera.x);
    host.value.dataset.cameraY = String(camera.y);
    host.value.dataset.cameraScale = String(camera.scale);
  }
  contentLayer?.position({ x: camera.x, y: camera.y });
  contentLayer?.scale({ x: camera.scale, y: camera.scale });
  contentLayer?.batchDraw();
  emit("zoomChange", camera.scale);
  emit("viewChange", { ...camera });
}

function getContentSize() {
  return {
    width: geometry.value.width,
    height: geometry.value.height,
  };
}

function fitContent() {
  if (!stage) return;
  const content = getContentSize();
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

function loadPreview(url: string, node: Konva.Image) {
  const cached = imageCache.get(url);
  if (cached) {
    cached.nodes.add(node);
    node.image(cached.image);
    if (cached.loaded) node.getLayer()?.batchDraw();
    return;
  }

  const image = new window.Image();
  image.decoding = "async";
  const entry: PreviewImageEntry = { image, loaded: false, nodes: new Set([node]) };
  imageCache.set(url, entry);
  node.image(image);
  image.onload = () => {
    entry.loaded = true;
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
  if (stage) stage.container().style.cursor = "grab";
  contentLayer?.batchDraw();
}

function bindCellDrag(group: Konva.Group, item: DragItem, source: GridPosition) {
  group.on("mouseenter", () => {
    if (stage && !spacePressed) stage.container().style.cursor = "grab";
  });
  group.on("mouseleave", () => {
    if (stage && !panning && !activeDrag) stage.container().style.cursor = "default";
  });
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
    if (stage) stage.container().style.cursor = "grabbing";
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
    if (stage) stage.container().style.cursor = "grab";
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
    draggable: props.editable,
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
      loadPreview(preview.url, previewNode);
      group.add(previewNode);
    }
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

  if (props.editable) bindCellDrag(group, { kind: "page", pageNumber }, source);

  return group;
}

function createSpacerGroup(spacerId: string, source: GridPosition): Konva.Group {
  const frame = frameForCell(source);
  const group = new Konva.Group({
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    draggable: props.editable,
    name: "layout-item layout-spacer",
  });
  group.add(
    new Konva.Rect({
      width: frame.width,
      height: frame.height,
      fill: props.backgroundColor,
      strokeScaleEnabled: false,
      ...(props.showGrid
        ? { stroke: "#8d867c", strokeWidth: 2, dash: [18, 12] }
        : { strokeWidth: 0 }),
    }),
  );
  if (props.showGrid) {
    group.add(
      new Konva.Text({
        width: frame.width,
        height: frame.height,
        text: "空白占位",
        align: "center",
        verticalAlign: "middle",
        fill: "#625d55",
        fontSize: 42,
        listening: false,
      }),
    );
  }
  if (props.editable) {
    group.on("dblclick dbltap", () => emit("deleteSpacer", spacerId));
    bindCellDrag(group, { kind: "spacer", spacerId }, source);
  }
  return group;
}

function positionFromClient(clientX: number, clientY: number): GridPosition | undefined {
  if (!host.value) return undefined;
  const bounds = host.value.getBoundingClientRect();
  const worldX = (clientX - bounds.left - camera.x) / camera.scale;
  const worldY = (clientY - bounds.top - camera.y) / camera.scale;
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
  if (!props.editable) return;
  if (!event.dataTransfer?.types.includes("application/x-pdf2plt-spacer")) return;
  event.dataTransfer.dropEffect = "copy";
  showDropTarget(positionFromClient(event.clientX, event.clientY));
}

function handleExternalDragLeave(event: DragEvent) {
  if (!props.editable) return;
  const related = event.relatedTarget;
  if (related instanceof Node && host.value?.contains(related)) return;
  showDropTarget();
}

function handleExternalDrop(event: DragEvent) {
  if (!props.editable) return;
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
  const previewByPage = new Map(
    props.previews.map((preview) => [preview.pageNumber, preview]),
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
          ...(cell
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
  stage.container().style.cursor = "grabbing";
}

function stopPan() {
  panning = false;
  lastPointer = undefined;
  if (stage) stage.container().style.cursor = spacePressed ? "grab" : "default";
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.code === "Escape" && activeDrag) {
    event.preventDefault();
    cancelActiveDrag();
    return;
  }
  if (event.code !== "Space") return;
  if (!pointerInside && document.activeElement !== host.value) return;
  event.preventDefault();
  spacePressed = true;
  contentLayer?.find(".layout-item").forEach((node) => node.draggable(false));
  if (stage && !panning) stage.container().style.cursor = "grab";
}

function handleKeyUp(event: KeyboardEvent) {
  if (event.code !== "Space") return;
  spacePressed = false;
  contentLayer?.find(".layout-item").forEach((node) => node.draggable(props.editable));
  stopPan();
}

function handleBlur() {
  spacePressed = false;
  contentLayer?.find(".layout-item").forEach((node) => node.draggable(props.editable));
  stopPan();
}

onMounted(() => {
  if (!host.value) return;
  stage = new Konva.Stage({ container: host.value, width: 1, height: 1 });
  contentLayer = new Konva.Layer();
  stage.add(contentLayer);
  resizeStage();
  renderScene();
  if (props.initialCamera) applyCamera({ ...props.initialCamera });
  else fitContent();

  stage.on("wheel", (event) => {
    event.evt.preventDefault();
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    const factor = event.evt.deltaY > 0 ? 0.9 : 1.1;
    applyCamera(zoomCameraAtPoint(camera, pointer, factor));
  });
  stage.on("mousedown", (event) => {
    host.value?.focus();
    const button = event.evt.button;
    if (isCanvasPanGesture(button, spacePressed)) {
      event.evt.preventDefault();
      startPan(stage?.getPointerPosition() ?? null);
    }
  });
  stage.on("contextmenu", (event) => {
    event.evt.preventDefault();
  });
  stage.on("mousemove", () => {
    const pointer = stage?.getPointerPosition();
    if (!panning || !pointer || !lastPointer) return;
    applyCamera(
      panCameraBy(camera, {
        x: pointer.x - lastPointer.x,
        y: pointer.y - lastPointer.y,
      }),
    );
    lastPointer = pointer;
  });
  stage.on("mouseenter", () => {
    pointerInside = true;
  });
  stage.on("mouseup", stopPan);
  stage.on("mouseleave", () => {
    pointerInside = false;
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
  ] as const,
  async ([layout, , , guides], [previousLayout, , , previousGuides]) => {
    renderScene();
    if (
      layout.rows !== previousLayout.rows ||
      layout.columns !== previousLayout.columns ||
      guides !== previousGuides
    ) {
      await nextTick();
      fitContent();
    }
  },
  { deep: true },
);

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  window.removeEventListener("keydown", handleKeyDown);
  window.removeEventListener("keyup", handleKeyUp);
  window.removeEventListener("blur", handleBlur);
  stage?.destroy();
  imageCache.clear();
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
  />
</template>
