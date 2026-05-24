import { useEffect, useRef, useState } from "react";
import { emit } from "@tauri-apps/api/event";

interface Point {
  x: number;
  y: number;
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export default function Selector() {
  const [rect, setRect] = useState<Rect | null>(null);
  const startRef = useRef<Point | null>(null);
  const dragging = useRef(false);

  // Escape cancels
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") emit("buddy:cancel");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startRef.current = { x: e.clientX, y: e.clientY };
    setRect(null);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current || !startRef.current) return;
    const s = startRef.current;
    setRect({
      x: Math.min(e.clientX, s.x),
      y: Math.min(e.clientY, s.y),
      w: Math.abs(e.clientX - s.x),
      h: Math.abs(e.clientY - s.y),
    });
  };

  const onMouseUp = async () => {
    if (!dragging.current) return;
    dragging.current = false;

    if (!rect || rect.w < 10 || rect.h < 10) {
      emit("buddy:cancel");
      return;
    }

    // Scale CSS pixels → physical pixels for xcap
    const scale = window.devicePixelRatio || 1;
    await emit("buddy:region", {
      x: Math.round(rect.x * scale),
      y: Math.round(rect.y * scale),
      width: Math.round(rect.w * scale),
      height: Math.round(rect.h * scale),
    });
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        cursor: "crosshair",
        userSelect: "none",
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      {rect && rect.w > 1 && rect.h > 1 ? (
        <>
          {/* Four dark panels around the clear selection area */}
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              height: rect.y,
              background: "rgba(0,0,0,0.55)",
            }}
          />
          <div
            style={{
              position: "fixed",
              top: rect.y + rect.h,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(0,0,0,0.55)",
            }}
          />
          <div
            style={{
              position: "fixed",
              top: rect.y,
              left: 0,
              width: rect.x,
              height: rect.h,
              background: "rgba(0,0,0,0.55)",
            }}
          />
          <div
            style={{
              position: "fixed",
              top: rect.y,
              left: rect.x + rect.w,
              right: 0,
              height: rect.h,
              background: "rgba(0,0,0,0.55)",
            }}
          />

          {/* Dashed selection border */}
          <div
            style={{
              position: "fixed",
              left: rect.x,
              top: rect.y,
              width: rect.w,
              height: rect.h,
              outline: "1.5px dashed rgba(255,255,255,0.85)",
              pointerEvents: "none",
            }}
          />

          {/* Dimensions badge */}
          <div
            style={{
              position: "fixed",
              left: rect.x,
              top: Math.max(0, rect.y - 24),
              background: "rgba(0,0,0,0.75)",
              color: "#fff",
              fontSize: 11,
              fontFamily: "monospace",
              padding: "2px 7px",
              borderRadius: 4,
              pointerEvents: "none",
            }}
          >
            {rect.w}×{rect.h}
          </div>
        </>
      ) : (
        /* Full overlay with hint before dragging */
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              textAlign: "center",
              color: "rgba(255,255,255,0.7)",
              fontSize: 14,
            }}
          >
            <div>Drag to select an area</div>
            <div
              style={{
                fontSize: 12,
                marginTop: 6,
                color: "rgba(255,255,255,0.4)",
              }}
            >
              Esc to cancel
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
