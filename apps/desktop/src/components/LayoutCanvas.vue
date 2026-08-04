<script setup lang="ts">
import {
  flattenLayout,
  type GridPosition,
  type LayoutGrid,
  type PageSizePt,
} from "@pdf2plt/core";
import Konva from "konva";
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import type { PreviewState } from "../stores/pdf-document";
import {
  fitCameraToContent,
  panCameraBy,
  zoomCameraAtPoint,
  type Camera,
  type Point,
} from "../canvas/camera";

const props = defineProps<{
  layout: LayoutGrid;
  pageSize: PageSizePt;
  previews: PreviewState[];
}>();

const emit = defineEmits<{
  zoomChange: [scale: number];
  movePage: [pageNumber: number, target: GridPosition];
}>();

interface ActiveDrag {
  group: Konva.Group;
  pageNumber: number;
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
const imageCache = new Map<string, HTMLImageElement>();

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
}

function getContentSize() {
  return {
    width: props.layout.columns * props.pageSize.width,
    height: props.layout.rows * props.pageSize.height,
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

function loadPreview(url: string, node: Konva.Image) {
  const cached = imageCache.get(url);
  if (cached) {
    node.image(cached);
    return;
  }

  const image = new window.Image();
  image.decoding = "async";
  image.onload = () => {
    imageCache.set(url, image);
    if (node.getLayer()) {
      node.image(image);
      node.getLayer()?.batchDraw();
    }
  };
  image.src = url;
}

function positionForCell(position: GridPosition): Point {
  return {
    x: position.column * props.pageSize.width,
    y: position.row * props.pageSize.height,
  };
}

function getDragTarget(group: Konva.Group): GridPosition | undefined {
  const column = Math.floor(
    (group.x() + props.pageSize.width / 2) / props.pageSize.width,
  );
  const row = Math.floor(
    (group.y() + props.pageSize.height / 2) / props.pageSize.height,
  );
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
  dropHighlight.show();
  dropHighlight.moveToTop();
  contentLayer?.batchDraw();
}

function restoreDraggedGroup(drag: ActiveDrag) {
  if (host.value) delete host.value.dataset.draggingPage;
  drag.group.position(positionForCell(drag.source));
  drag.group.opacity(1);
  showDropTarget();
  if (stage) stage.container().style.cursor = "grab";
  contentLayer?.batchDraw();
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
  const origin = positionForCell(source);
  const group = new Konva.Group({
    ...origin,
    width: props.pageSize.width,
    height: props.pageSize.height,
    draggable: true,
    name: "layout-page",
  });
  group.setAttr("pageNumber", pageNumber);
  group.add(
    new Konva.Rect({
      width: props.pageSize.width,
      height: props.pageSize.height,
      fill: "#ffffff",
    }),
  );

  if (preview) {
    const previewNode = new Konva.Image({
      image: imageCache.get(preview.url) ?? new window.Image(),
      width: props.pageSize.width,
      height: props.pageSize.height,
      listening: false,
    });
    loadPreview(preview.url, previewNode);
    group.add(previewNode);
  }

  group.add(
    new Konva.Rect({
      width: props.pageSize.width,
      height: props.pageSize.height,
      stroke: "#314a59",
      strokeWidth: 1.5,
      strokeScaleEnabled: false,
      listening: false,
    }),
  );
  group.add(
    new Konva.Label({ x: 18, y: 18, listening: false })
      .add(
        new Konva.Tag({
          fill: "#10212b",
          opacity: 0.9,
          cornerRadius: 8,
        }),
      )
      .add(
        new Konva.Text({
          text: `${pageNumber}`,
          fill: "#e8f4fa",
          fontSize: 30,
          fontStyle: "bold",
          padding: 11,
        }),
      ),
  );

  group.on("mouseenter", () => {
    if (stage && !spacePressed) stage.container().style.cursor = "grab";
  });
  group.on("mouseleave", () => {
    if (stage && !panning && !activeDrag) stage.container().style.cursor = "default";
  });
  group.on("dragstart", () => {
    activeDrag = { group, pageNumber, source, target: undefined };
    if (host.value) host.value.dataset.draggingPage = String(pageNumber);
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
      restoreDraggedGroup({ group, pageNumber, source, target: undefined });
      return;
    }

    group.position(positionForCell(drag.target));
    group.opacity(1);
    if (host.value) delete host.value.dataset.draggingPage;
    showDropTarget();
    if (stage) stage.container().style.cursor = "grab";
    emit("movePage", pageNumber, drag.target);
  });

  return group;
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
      .map((cell) => (cell?.kind === "page" ? cell.pageNumber : "-"))
      .join(",");
    host.value.dataset.pageWidth = String(props.pageSize.width);
    host.value.dataset.pageHeight = String(props.pageSize.height);
    host.value.dataset.layoutRows = String(props.layout.rows);
    host.value.dataset.layoutColumns = String(props.layout.columns);
  }

  for (let row = 0; row < props.layout.rows; row += 1) {
    for (let column = 0; column < props.layout.columns; column += 1) {
      const cell = props.layout.cells[row]?.[column];
      const x = column * props.pageSize.width;
      const y = row * props.pageSize.height;

      contentLayer.add(
        new Konva.Rect({
          x,
          y,
          width: props.pageSize.width,
          height: props.pageSize.height,
          fill: cell ? "#ffffff" : "#182026",
          stroke: cell ? "#557080" : "#35434c",
          strokeWidth: 1,
          strokeScaleEnabled: false,
          ...(cell ? {} : { dash: [10, 8] }),
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
      }
    }
  }

  dropHighlight = new Konva.Rect({
    width: props.pageSize.width,
    height: props.pageSize.height,
    fill: "#63b9df",
    opacity: 0.22,
    stroke: "#8fdcff",
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
  contentLayer?.find(".layout-page").forEach((node) => node.draggable(false));
  if (stage && !panning) stage.container().style.cursor = "grab";
}

function handleKeyUp(event: KeyboardEvent) {
  if (event.code !== "Space") return;
  spacePressed = false;
  contentLayer?.find(".layout-page").forEach((node) => node.draggable(true));
  stopPan();
}

function handleBlur() {
  spacePressed = false;
  contentLayer?.find(".layout-page").forEach((node) => node.draggable(true));
  stopPan();
}

onMounted(() => {
  if (!host.value) return;
  stage = new Konva.Stage({ container: host.value, width: 1, height: 1 });
  contentLayer = new Konva.Layer();
  stage.add(contentLayer);
  resizeStage();
  renderScene();
  fitContent();

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
    if (button === 1 || (button === 0 && spacePressed)) {
      event.evt.preventDefault();
      startPan(stage?.getPointerPosition() ?? null);
    }
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
  () => [props.layout, props.pageSize, props.previews] as const,
  async ([layout], [previousLayout]) => {
    renderScene();
    if (
      layout.rows !== previousLayout.rows ||
      layout.columns !== previousLayout.columns
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

defineExpose({ fitContent });
</script>

<template>
  <div
    ref="host"
    class="layout-canvas"
    tabindex="0"
    aria-label="PDF 自动排版画板"
    @blur="handleBlur"
  />
</template>
