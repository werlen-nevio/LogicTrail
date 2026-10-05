export interface Transform {
  x: number;
  y: number;
  k: number;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 3;
const DRAG_THRESHOLD = 4;
const FIT_PADDING = 56;
/** Below this zoom node labels become hard to read. */
const READABLE_SCALE = 0.6;

/**
 * Pan and zoom for an SVG <g> viewport. Mouse wheels zoom around the cursor,
 * trackpad scrolling pans, pinch (ctrl + wheel) zooms, dragging pans.
 */
export class PanZoom {
  private transform: Transform = { x: 0, y: 0, k: 1 };
  private animation = 0;
  private drag:
    | {
        pointerId: number;
        startX: number;
        startY: number;
        originX: number;
        originY: number;
        active: boolean;
      }
    | undefined;
  private suppressClick = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly viewport: SVGGElement,
    private readonly content: { width: number; height: number },
    private readonly onChange: (transform: Transform) => void,
  ) {
    container.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    container.addEventListener("pointermove", (event) => this.onPointerMove(event));
    container.addEventListener("pointerup", (event) => this.onPointerUp(event));
    container.addEventListener("pointercancel", (event) => this.onPointerUp(event));
    container.addEventListener("wheel", (event) => this.onWheel(event), { passive: false });
    container.addEventListener(
      "click",
      (event) => {
        if (this.suppressClick) {
          event.stopPropagation();
          event.preventDefault();
          this.suppressClick = false;
        }
      },
      true,
    );
  }

  get current(): Transform {
    return { ...this.transform };
  }

  set(transform: Transform, animate = false): void {
    const target = { ...transform, k: clamp(transform.k, MIN_SCALE, MAX_SCALE) };
    cancelAnimationFrame(this.animation);
    if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.apply(target);
      return;
    }
    const start = { ...this.transform };
    const startTime = performance.now();
    const duration = 260;
    const step = (now: number): void => {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      this.apply({
        x: start.x + (target.x - start.x) * eased,
        y: start.y + (target.y - start.y) * eased,
        k: start.k + (target.k - start.k) * eased,
      });
      if (t < 1) this.animation = requestAnimationFrame(step);
    };
    this.animation = requestAnimationFrame(step);
  }

  fit(animate = false): void {
    const { width, height } = this.size();
    if (this.content.width === 0 || this.content.height === 0 || width === 0) return;
    const k = clamp(
      Math.min(
        (width - FIT_PADDING * 2) / this.content.width,
        (height - FIT_PADDING * 2) / this.content.height,
        1.1,
      ),
      MIN_SCALE,
      MAX_SCALE,
    );
    this.set(
      {
        k,
        x: (width - this.content.width * k) / 2,
        y: Math.max(FIT_PADDING / 2, (height - this.content.height * k) / 2),
      },
      animate,
    );
  }

  /**
   * The first view: fit everything when that stays readable; otherwise open at a
   * readable zoom anchored on the entry point (F still fits everything).
   */
  initial(anchor: { x: number; y: number } | undefined): void {
    const { width, height } = this.size();
    if (this.content.width === 0 || width === 0) return;
    const fitScale = Math.min(
      (width - FIT_PADDING * 2) / this.content.width,
      (height - FIT_PADDING * 2) / this.content.height,
    );
    if (fitScale >= READABLE_SCALE || !anchor) {
      this.fit(false);
      return;
    }
    const k = Math.min(0.85, Math.max(READABLE_SCALE, fitScale));
    const contentWidth = this.content.width * k;
    const x =
      contentWidth <= width
        ? (width - contentWidth) / 2
        : clamp(width / 2 - anchor.x * k, width - contentWidth - FIT_PADDING, FIT_PADDING);
    this.set({ k, x, y: FIT_PADDING / 2 - Math.max(0, anchor.y * k - height * 0.2) }, false);
  }

  zoomBy(factor: number, center?: { x: number; y: number }, animate = true): void {
    const { width, height } = this.size();
    const origin = center ?? { x: width / 2, y: height / 2 };
    const k = clamp(this.transform.k * factor, MIN_SCALE, MAX_SCALE);
    const ratio = k / this.transform.k;
    this.set(
      {
        k,
        x: origin.x - (origin.x - this.transform.x) * ratio,
        y: origin.y - (origin.y - this.transform.y) * ratio,
      },
      animate,
    );
  }

  /** Centers a point given in graph coordinates. */
  centerOn(x: number, y: number, minScale = 0.8): void {
    const { width, height } = this.size();
    const k = Math.max(this.transform.k, minScale);
    this.set({ k, x: width / 2 - x * k, y: height / 2 - y * k }, true);
  }

  isVisible(x: number, y: number, margin = 60): boolean {
    const { width, height } = this.size();
    const screenX = x * this.transform.k + this.transform.x;
    const screenY = y * this.transform.k + this.transform.y;
    return (
      screenX > margin && screenX < width - margin && screenY > margin && screenY < height - margin
    );
  }

  private size(): { width: number; height: number } {
    const rect = this.container.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  private apply(transform: Transform): void {
    this.transform = transform;
    this.viewport.setAttribute(
      "transform",
      `translate(${transform.x},${transform.y}) scale(${transform.k})`,
    );
    this.onChange({ ...transform });
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    cancelAnimationFrame(this.animation);
    this.drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: this.transform.x,
      originY: this.transform.y,
      active: false,
    };
  }

  private onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (drag?.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.active) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      drag.active = true;
      // Capture only once dragging starts, so plain clicks still reach nodes.
      this.container.setPointerCapture(event.pointerId);
      this.container.classList.add("is-panning");
    }
    this.apply({ ...this.transform, x: drag.originX + dx, y: drag.originY + dy });
  }

  private onPointerUp(event: PointerEvent): void {
    const drag = this.drag;
    if (drag?.pointerId !== event.pointerId) return;
    if (drag.active) {
      this.suppressClick = true;
      window.setTimeout(() => (this.suppressClick = false), 0);
      if (this.container.hasPointerCapture(event.pointerId))
        this.container.releasePointerCapture(event.pointerId);
    }
    this.container.classList.remove("is-panning");
    this.drag = undefined;
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    cancelAnimationFrame(this.animation);
    const rect = this.container.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const isPinch = event.ctrlKey || event.metaKey;
    const isMouseWheel =
      event.deltaMode !== 0 ||
      (event.deltaX === 0 && Math.abs(event.deltaY) >= 40 && Number.isInteger(event.deltaY));
    if (isPinch || isMouseWheel) {
      const unit = event.deltaMode === 1 ? 0.05 : isPinch ? 0.01 : 0.0018;
      this.zoomBy(Math.exp(-event.deltaY * unit), point, false);
      return;
    }
    this.apply({
      ...this.transform,
      x: this.transform.x - event.deltaX,
      y: this.transform.y - event.deltaY,
    });
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
