import { useEffect, useRef, useState } from "react"
import { useBuddyStore, type Segment } from "../store"

interface DrawerProps {
  onStop: () => void
}

export default function Drawer({ onStop }: DrawerProps) {
  const isCapturing    = useBuddyStore((s) => s.isCapturing)
  const liveTranscript = useBuddyStore((s) => s.liveTranscript)

  const scrollRef      = useRef<HTMLDivElement>(null)
  const [userScrolled, setUserScrolled] = useState(false)

  // ── Auto-scroll (pause when user scrolls up, resume near bottom) ──────────
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
      setUserScrolled(!nearBottom)
    }
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => el.removeEventListener("scroll", onScroll)
  }, [])

  useEffect(() => {
    if (!userScrolled && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [liveTranscript, userScrolled])

  return (
    <div
      style={{
        display:        "flex",
        flexDirection:  "column",
        width:          "100%",
        height:         "100%",
        background:     "rgba(10,10,14,0.92)",
        backdropFilter: "blur(12px)",
        borderLeft:     "1px solid rgba(255,255,255,0.07)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          padding:        "14px 16px 10px",
          borderBottom:   "1px solid rgba(255,255,255,0.06)",
          flexShrink:     0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isCapturing ? (
            <>
              {/* Pulsing REC dot */}
              <span style={{ position: "relative", display: "inline-flex", width: 8, height: 8 }}>
                <span
                  style={{
                    position:  "absolute",
                    inset:     0,
                    borderRadius: "50%",
                    background: "#ef4444",
                    opacity:   0.75,
                    animation: "ping 1.2s cubic-bezier(0,0,0.2,1) infinite",
                  }}
                />
                <span
                  style={{
                    position:     "relative",
                    display:      "inline-flex",
                    width:        8,
                    height:       8,
                    borderRadius: "50%",
                    background:   "#ef4444",
                  }}
                />
              </span>
              <span style={{ color: "#ef4444", fontSize: 11, fontWeight: 600, letterSpacing: "0.05em" }}>
                REC
              </span>
            </>
          ) : (
            <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, fontWeight: 500 }}>
              ● REC stopped
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 10 }}>
            {isCapturing ? "Ctrl+Shift+R to stop" : ""}
          </span>
          {isCapturing && (
            <button
              onClick={onStop}
              title="Stop recording"
              style={{
                background:  "rgba(239,68,68,0.15)",
                border:      "1px solid rgba(239,68,68,0.3)",
                borderRadius: 6,
                color:       "#f87171",
                fontSize:    11,
                fontWeight:  500,
                padding:     "3px 8px",
                cursor:      "pointer",
              }}
            >
              Stop
            </button>
          )}
        </div>
      </div>

      {/* Transcript scroll area */}
      <div
        ref={scrollRef}
        style={{
          flex:       1,
          overflowY:  "auto",
          padding:    "10px 16px",
        }}
      >
        {liveTranscript.length === 0 ? (
          <p style={{ color: "rgba(255,255,255,0.2)", fontSize: 11, marginTop: 8 }}>
            {isCapturing
              ? "Listening… speech will appear here."
              : "No transcript yet."}
          </p>
        ) : (
          liveTranscript.map((seg) => (
            <SegmentRow key={seg.id} seg={seg} />
          ))
        )}
      </div>

      {/* Scroll-to-bottom nudge */}
      {userScrolled && liveTranscript.length > 0 && (
        <button
          onClick={() => {
            if (scrollRef.current) {
              scrollRef.current.scrollTop = scrollRef.current.scrollHeight
            }
            setUserScrolled(false)
          }}
          style={{
            position:     "absolute",
            bottom:       16,
            right:        16,
            background:   "rgba(255,255,255,0.1)",
            border:       "1px solid rgba(255,255,255,0.15)",
            borderRadius: 20,
            color:        "rgba(255,255,255,0.6)",
            fontSize:     11,
            padding:      "4px 10px",
            cursor:       "pointer",
          }}
        >
          ↓ latest
        </button>
      )}

      {/* Inline keyframe for the ping animation */}
      <style>{`
        @keyframes ping {
          75%, 100% { transform: scale(2); opacity: 0; }
        }
      `}</style>
    </div>
  )
}

function SegmentRow({ seg }: { seg: Segment }) {
  return (
    <p
      style={{
        fontSize:    12,
        lineHeight:  1.6,
        color:       seg.committed ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.4)",
        fontStyle:   seg.committed ? "normal" : "italic",
        marginBottom: 4,
        userSelect:  "text",
        transition:  "color 0.2s, font-style 0.2s",
        wordBreak:   "break-word",
      }}
    >
      {seg.text}
    </p>
  )
}
