<script setup lang="ts">
import type { LayoutGrid, PageSizePt } from "@pdf2plt/core";
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
}>();

const host = ref<HTMLDivElement>();
let stage: Konva.Stage | undefined;
let contentLayer: Konva.Layer | undefined;
let resizeObserver: ResizeObserver | undefined;
let camera: Camera = { x: 0, y: 0, scale: 1 };
let spacePressed = false;
let pointerInside = false;
let panning = false;
let lastPointer: Point | undefined;
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

function renderScene() {
  if (!contentLayer) return;
  contentLayer.destroyChildren();
  const previewByPage = new Map(
    props.previews.map((preview) => [preview.pageNumber, preview]),
  );

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

      if (cell?.kind !== "page") continue;
      const preview = previewByPage.get(cell.pageNumber);
      if (preview) {
        const previewNode = new Konva.Image({
          image: imageCache.get(preview.url) ?? new window.Image(),
          x,
          y,
          width: props.pageSize.width,
          height: props.pageSize.height,
          listening: false,
        });
        loadPreview(preview.url, previewNode);
        contentLayer.add(previewNode);
      }

      contentLayer.add(
        new Konva.Rect({
          x,
          y,
          width: props.pageSize.width,
          height: props.pageSize.height,
          stroke: "#314a59",
          strokeWidth: 1.5,
          strokeScaleEnabled: false,
          listening: false,
        }),
      );
      contentLayer.add(
        new Konva.Label({ x: x + 18, y: y + 18, listening: false })
          .add(
            new Konva.Tag({
              fill: "#10212b",
              opacity: 0.9,
              cornerRadius: 8,
            }),
          )
          .add(
            new Konva.Text({
              text: `${cell.pageNumber}`,
              fill: "#e8f4fa",
              fontSize: 30,
              fontStyle: "bold",
              padding: 11,
            }),
          ),
      );
    }
  }

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
  if (event.code !== "Space") return;
  if (!pointerInside && document.activeElement !== host.value) return;
  event.preventDefault();
  spacePressed = true;
  if (stage && !panning) stage.container().style.cursor = "grab";
}

function handleKeyUp(event: KeyboardEvent) {
  if (event.code !== "Space") return;
  spacePressed = false;
  stopPan();
}

function handleBlur() {
  spacePressed = false;
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
