# unmute Design System

The visual language for every surface in unmute. This document is the single source of truth for how things should look, feel, and move. Every new feature, every UI change, every animation should reference this file.

---

## Philosophy

**Invisible until needed. Unmistakable when present.**

unmute is a power tool, not a destination app. The UI should disappear into the user's workflow 99% of the time. But in that 1% when it appears -- during recording, processing, or chatting -- it should feel alive, intentional, and instantly recognizable.

If someone across a cafe glances at your screen, they should think: "that looks like something."

**Three principles:**

1. **Ambient presence** -- Small footprint, never intrusive, never steals attention from the user's real work. Inspired by Wispr Flow's philosophy: "a small, persistent bar that signals availability without noise."
2. **Alive, not static** -- Subtle motion tells the user the system is listening, thinking, or done. No dead screens. No spinners. Organic pulses, glows, and transitions.
3. **One material, everywhere** -- Every unmute surface uses the same dark glass material. Consistency creates identity.

---

## The Material: Dark Glass

Every unmute overlay is built from the same base material. The recording widget and Quick Chat panel differ in opacity — the widget is more opaque (it sits at the top of the screen briefly), the panel is hyper-transparent (it floats over the user's work for longer).

### Widget material
```
Background:    rgba(0, 0, 0, 0.82)
Backdrop:      blur(40px) saturate(180%)
Border:        1px solid rgba(255, 255, 255, 0.08)
Border Radius: 9999px (pill)
Shadow:        0 8px 32px rgba(0, 0, 0, 0.35),
               0 0 0 1px rgba(255, 255, 255, 0.05) inset
```

### Quick Chat panel material
```
Background:    rgba(0, 0, 0, 0.72)
Backdrop:      blur(60px) saturate(180%)
Border:        1px solid rgba(255, 255, 255, 0.12)
Border Radius: 24px
Shadow:        0 16px 48px rgba(0, 0, 0, 0.30),
               0 0 0 1px rgba(255, 255, 255, 0.06) inset
```

The Quick Chat panel is translucent — some background content bleeds through the blur, giving it a glass quality, but opacity is high enough (72%) to ensure all text is clearly readable. The panel should feel like dark tinted glass, not a transparent sheet.

**Why pure black?** Because unmute floats over the user's work. Pure black glass (not grey, not dark-blue) is the least disruptive — it recedes visually while remaining readable and gives the strongest contrast for white text.

**Inner glow**: A faint `inset` box-shadow at `rgba(255, 255, 255, 0.05)` creates the glass edge effect.

---

## Color Palette

### Primary — Monochrome

| Token | Value | Usage |
|---|---|---|
| `--unmute-accent` | `rgba(255, 255, 255, 0.88)` | Monochrome white. Active states, recording dot, glow |
| `--unmute-accent-soft` | `rgba(255, 255, 255, 0.10)` | Accent backgrounds, hover states |
| `--unmute-accent-glow` | `rgba(255, 255, 255, 0.20)` | Radiation glow during active/instruction states |

> **Monochrome design.** No color accent in overlays. Widget and Quick Chat use only white, grey, and opacity variations. The only exceptions are semantic colors: green for success, amber for warnings, red for errors only.

### Surface

| Token | Value | Usage |
|---|---|---|
| `--unmute-surface` | `rgba(0, 0, 0, 0.82)` | Widget glass background (pure black, more opaque) |
| `--unmute-surface-panel` | `rgba(0, 0, 0, 0.72)` | Quick Chat panel background (pure black, translucent glass) |
| `--unmute-surface-raised` | `rgba(255, 255, 255, 0.05)` | Cards, bubbles, elevated elements |
| `--unmute-surface-hover` | `rgba(255, 255, 255, 0.08)` | Hover state on raised surfaces |
| `--unmute-border` | `rgba(255, 255, 255, 0.10)` | Subtle borders on glass |
| `--unmute-border-focus` | `rgba(255, 255, 255, 0.25)` | Focus rings on inputs (white, not accent) |

### Text

| Token | Value | Usage |
|---|---|---|
| `--unmute-text-primary` | `rgba(255, 255, 255, 1.0)` | Main text on dark surfaces — fully opaque for readability |
| `--unmute-text-secondary` | `rgba(255, 255, 255, 0.65)` | Labels, timestamps, helper text |
| `--unmute-text-muted` | `rgba(255, 255, 255, 0.38)` | Placeholders, hints, branding |

### Semantic

| Token | Value | Usage |
|---|---|---|
| `--unmute-success` | `#00C896` | Done states, checkmarks |
| `--unmute-error` | `#FF4444` | Error states only |
| `--unmute-warning` | `#FFAA33` | Time warnings |
| `--unmute-recording` | `rgba(255, 255, 255, 0.88)` | Recording dot (monochrome) |

---

## Typography

Keep it simple. System fonts for performance and native feel.

```
--unmute-font-primary:  -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif
--unmute-font-mono:     'SF Mono', 'Menlo', 'Monaco', ui-monospace, monospace
--unmute-font-display:  -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', sans-serif
```

### Scale

| Token | Size | Weight | Usage |
|---|---|---|---|
| `--unmute-text-xs` | 10px | 400 | Badges, hints, branding |
| `--unmute-text-sm` | 12px | 400-500 | Helper text, timestamps, tool badges |
| `--unmute-text-base` | 13px | 400 | Body text, chat messages |
| `--unmute-text-md` | 14px | 500-600 | Labels, mode indicators |
| `--unmute-text-lg` | 16px | 600 | Section headers |

**Letter spacing**: `0.01em` on body text, `0.08-0.10em` on uppercase labels (like "unmute").

---

## Shape Language

**Everything is rounded.** unmute never uses sharp corners on floating surfaces.

| Element | Border Radius |
|---|---|
| Recording widget | `9999px` (full pill) |
| Quick Chat panel | `24px` |
| Chat bubbles | `16px` (with `5px` on the tail corner) |
| Buttons | `12px` (standard), `9999px` (pill buttons) |
| Input fields | `14px` |
| Badges & tags | `8px` |
| Code blocks | `10px` |
| Tooltips | `10px` |

**The widget is a pill.** Not a rectangle with rounded corners — a true capsule shape (border-radius: 9999px). This is the most distinctive shape in unmute.

**Quick Chat is a tall rounded rectangle.** Very rounded at 24px (slightly more than before) to match the softness of the hyper-transparent material. More rounded = lighter feel, which suits the transparency.

---

## The unmute Dot

The white dot is unmute's brand mark. It appears:

- In the recording widget (left side, pulsing)
- In the Quick Chat header (static when idle, pulsing when AI is processing)
- In the system tray (with ring animation)
- In the branding label ("unmute" text next to the dot)

**Dot specifications:**
- Size: 8px diameter (widget), 6px (Quick Chat header), 18px (tray)
- Color: `rgba(255, 255, 255, 0.88)` — monochrome white in all modes
- During recording: breathing pulse animation (scale 0.85 ↔ 1.0)
- Instruction mode uses same white dot with slightly brighter glow

```css
@keyframes dot-pulse-red {
  0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255,255,255,0.4); }
  50%       { transform: scale(0.85); box-shadow: 0 0 0 4px rgba(255,255,255,0.0); }
}

@keyframes dot-pulse-white {
  0%, 100% { transform: scale(1); }
  50%       { transform: scale(0.83); }
}
```

---

## Animation Language

### Principle: Organic, Not Mechanical

No linear easing. No abrupt state changes. Everything breathes.

**Default easing**: `cubic-bezier(0.16, 1, 0.3, 1)` for entrances (fast start, gentle settle)
**Exit easing**: `ease-in` or `cubic-bezier(0.4, 0, 1, 1)` (accelerate out)

### Radiation / Glow Effect

The signature unmute animation. A soft colored glow that pulses outward from the widget or panel edge.

**When it plays:**
- Recording widget: constant gentle pulse while recording
- Quick Chat: pulses while the AI is thinking/generating (stops once tokens stream)

**Two glow variants:**

**White glow** — dictation mode (Fn key):
```css
@keyframes bolo-radiate-white {
  0%, 100% {
    box-shadow: 0 8px 32px rgba(0,0,0,0.35),
                0 0 0 1px rgba(255,255,255,0.05) inset,
                0 0 15px rgba(255,255,255,0.08);
  }
  50% {
    box-shadow: 0 8px 32px rgba(0,0,0,0.35),
                0 0 0 1px rgba(255,255,255,0.05) inset,
                0 0 28px rgba(255,255,255,0.18),
                0 0 50px rgba(255,255,255,0.08);
  }
}
```

**Bright white glow** — instruction mode (Control) and processing:
```css
@keyframes bolo-radiate-red {
  0%, 100% {
    box-shadow: 0 8px 32px rgba(0,0,0,0.35),
                0 0 0 1px rgba(255,255,255,0.05) inset,
                0 0 15px rgba(255,255,255,0.10),
                0 0 30px rgba(255,255,255,0.05);
  }
  50% {
    box-shadow: 0 8px 32px rgba(0,0,0,0.35),
                0 0 0 1px rgba(255,255,255,0.05) inset,
                0 0 22px rgba(255,255,255,0.25),
                0 0 55px rgba(255,255,255,0.10);
  }
}
```

- Duration: 2s for recording, 1.5s for processing (faster = more urgency)
- Easing: `ease-in-out`

**Quick Chat panel glow** (while AI is thinking):
```css
/* Applied as box-shadow animation on the panel */
box-shadow: 0 16px 48px rgba(0,0,0,0.30),
            0 0 0 0.5px rgba(255,255,255,0.06),
            0 0 35px rgba(255,255,255,0.10),
            0 0 60px rgba(255,255,255,0.04);
```

### Entry / Exit

| Animation | Duration | Easing | Description |
|---|---|---|---|
| Widget enter | 250ms | `cubic-bezier(0.16, 1, 0.3, 1)` | Slide down + fade in from top |
| Widget exit | 180ms | `ease-in` | Slide up + fade out |
| Quick Chat enter | 300ms | `cubic-bezier(0.16, 1, 0.3, 1)` | Slide in from right + fade |
| Quick Chat exit | 200ms | `ease-in` | Slide out to right + fade |
| Bubble appear | 200ms | `ease-out` | Fade up from 6px below |
| Success state | 350ms | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Scale pop (0.85 → 1.05 → 1.0) |

### Micro-animations

- **Typing indicator dots**: 3 dots bouncing with 150ms stagger. Each dot: scale 0.6 → 1.0 → 0.6 over 1.2s.
- **Streaming cursor**: A thin `|` that blinks at 530ms interval while tokens stream.
- **Button hover**: 150ms background transition to `--unmute-surface-hover`.
- **Button press**: `scale(0.96)` on active, 100ms.

---

## Recording Widget (Pill)

### Layout

```
[ (dot) Dictating...   0:05   ~~~waveform~~~   (stop) ]
```

A single horizontal row inside a pill-shaped container:
1. **unmute dot** — pulsing white (both dictation and instruction modes)
2. **Mode label** — "Dictating..." or "Listening..." in secondary text
3. **Timer** — monospace, muted, right of label
4. **Mini waveform** — compact, ~80px wide, 20px tall, shows audio levels
5. **Stop button** — small circle with square icon, rightmost

### Dimensions
- **Width**: ~340px (flexible, content-driven)
- **Height**: 48px (compact single-row pill)
- **Padding**: 8px 16px (left/right), 8px (top/bottom)
- **Gap between elements**: 10px

### Visual States

**Recording — Dictation (Fn key)**:
- Soft white glow radiation (2s cycle)
- Dot is white, pulses white
- Waveform bars are white (`rgba(255, 255, 255, 0.65)`)
- Timer counts up
- Label: "Dictating..."

**Recording — Instruction (Control)**:
- Bright white glow radiation (2s cycle)
- Dot is white (`rgba(255, 255, 255, 0.88)`), pulses
- Waveform bars are white (`rgba(255, 255, 255, 0.85)`)
- Timer counts up
- Label: "Listening..."

**Processing**:
- Bright white glow radiation, faster cycle (1.5s)
- Dot is white, pulsing
- Waveform replaced by shimmer bar (white gradient)
- Label: "Processing..."
- Timer hidden

**Output (success)**:
- Radiation stops
- Green checkmark (`✓`) with scale pop animation
- Truncated output preview text
- Auto-hides after 2.5s

**Cancelled**:
- No radiation
- X icon + "Cancelled" + Undo button
- Undo button uses accent-soft background

**Error**:
- Brief red-tinted glow flash
- Error icon + message
- Auto-hides after 3s

**Too short**:
- Muted state, no radiation, reduced opacity (0.65)
- Mic-off icon + "Too short"
- Auto-hides after 2s

---

## Quick Chat Panel

### Overview

The Quick Chat panel uses translucent dark glass. Background content bleeds through subtly via the blur effect, creating a glass quality, but the opacity is high enough (72%) to ensure all text is prominently readable. The panel should feel like dark tinted glass — present enough to read comfortably, transparent enough to stay connected to the desktop.

**Monochrome design** — no color accent in the panel. The unmute dot is white. Source links use muted white. Send button is white. Everything is white, muted, or transparent.

### Layout

```
+---------------------------+
| (dot) unmute         [✕]   |  ← Header (draggable, very light)
+---------------------------+
|                           |
|  [user bubble]            |  ← Messages area (scrollable)
|        [assistant bubble] |
|  [user bubble]            |
|                           |
|     (typing dots...)      |  ← Processing indicator
|                           |
+---------------------------+
| [input field]      [→]   |  ← Input area
+---------------------------+
```

### Panel Shell

```
background:       rgba(0, 0, 0, 0.72)
backdrop-filter:  blur(60px) saturate(180%)
border:           1px solid rgba(255, 255, 255, 0.12)
border-radius:    24px
box-shadow:       0 16px 48px rgba(0, 0, 0, 0.30),
                  0 0 0 1px rgba(255, 255, 255, 0.06) inset
```

### Header

```
background:    rgba(255, 255, 255, 0.03)
border-bottom: 1px solid rgba(255, 255, 255, 0.07)
padding:       12px 16px
```

- unmute dot: 6px, white (`rgba(255,255,255,0.70)`), static unless AI is processing
- "unmute" wordmark: 11px, weight 700, letter-spacing 0.10em, color `rgba(255,255,255,0.40)` — very muted
- Close button: 22px circle, `rgba(255,255,255,0.05)` background

### Chat Bubbles

**User bubbles** (right-aligned) — white-tinted frosted glass, no accent color:
```
background:    rgba(255, 255, 255, 0.10)
border:        1px solid rgba(255, 255, 255, 0.12)
border-radius: 16px 16px 5px 16px
color:         rgba(255, 255, 255, 0.90)
backdrop-filter: blur(8px)
padding:       9px 13px
font-size:     13px
```

**Assistant bubbles** (left-aligned) — near-invisible glass:
```
background:    rgba(255, 255, 255, 0.04)
border:        1px solid rgba(255, 255, 255, 0.07)
border-radius: 16px 16px 16px 5px
color:         rgba(255, 255, 255, 0.88)
padding:       9px 13px
font-size:     13px
```

The distinction between user and assistant bubbles is purely through opacity and alignment — user messages are slightly brighter glass (10% vs 4%). If readability is an issue, user bubble can go up to 14% without losing the transparent quality.

### Processing State

When AI is thinking:
- A soft white glow appears on the panel border (applied as box-shadow)
- Typing dots animate inside an assistant-style bubble
- The unmute dot pulses white
- Once streaming begins, glow stops, typing dots disappear, streaming cursor appears

### Empty State

No emoji. Instead:
- "Ask me anything" — centered, `rgba(255,255,255,0.45)`, 13px
- "speak or type below" — below it, `rgba(255,255,255,0.25)`, 11px
- Vertically centered in the messages area

### Input Area

```
background:    rgba(0, 0, 0, 0.10)
border-top:    1px solid rgba(255, 255, 255, 0.06)
padding:       11px 12px
gap:           8px
```

Input field:
```
background:    rgba(255, 255, 255, 0.05)
border:        1px solid rgba(255, 255, 255, 0.08)
border-radius: 14px
padding:       9px 13px
color:         rgba(255, 255, 255, 0.88)
placeholder:   rgba(255, 255, 255, 0.25)
focus border:  rgba(255, 255, 255, 0.22)   ← white, not red
```

Send button:
```
width/height:  30px circle
background:    rgba(255, 255, 255, 0.88)
color:         rgba(0, 0, 0, 0.85)
```
Only visible when input has content. White circle with dark arrow icon.

### Source Links & Tool Badges

Tool badges — muted, recessive:
```
background:    rgba(255, 255, 255, 0.05)
border:        1px solid rgba(255, 255, 255, 0.07)
border-radius: 8px
color:         rgba(255, 255, 255, 0.35)
font-size:     11px
```

Source links — monochrome muted:
```
color:       rgba(255, 255, 255, 0.60)
font-size:   11px
border-radius: 5px
hover background: rgba(255, 255, 255, 0.08)
```

---

## Spacing System

Consistent spacing creates rhythm. Use multiples of 4px.

| Token | Value | Usage |
|---|---|---|
| `--space-1` | 4px | Tight gaps (badge padding, icon gaps) |
| `--space-2` | 8px | Standard inner padding, gap between elements |
| `--space-3` | 12px | Section padding, input padding |
| `--space-4` | 16px | Container padding, message gap |
| `--space-5` | 20px | Large section gaps |
| `--space-6` | 24px | Panel padding |

---

## Iconography

Minimal, stroke-based, 1.5-2px stroke weight. Match the system SF Symbols style.

- **Stop**: Square (rounded 2px corners) inside a circle
- **Close**: X (two diagonal lines)
- **Send**: Arrow pointing right (chevron style)
- **Check**: Simple checkmark polyline
- **Error**: X inside a circle
- **Mic off**: Mic with diagonal strike-through
- **Warning**: Triangle with exclamation

All icons are 13-16px, stroke color inherits from parent text color.

---

## Applying This System to Future Features

When building any new unmute surface:

1. **Start with the glass material** — widget uses `--unmute-surface` (82% opacity), panel uses `--unmute-surface-panel` (72% opacity)
2. **Use the color tokens** — Never hardcode colors, always reference tokens
3. **Round everything** — Minimum 10px radius on any container
4. **Add radiation where appropriate** — Soft white glow for dictation, brighter white glow for instruction/processing
5. **Respect the pill** — The widget is always a pill. Other surfaces are rounded rectangles.
6. **Keep text hierarchy** — Primary for content, secondary for labels, muted for hints
7. **Monochrome everywhere** — No color accent in overlays. Only semantic colors (green=success, amber=warning, red=error).
8. **Animate with intent** — Every transition has purpose. No animation for decoration.

---

## Color Usage Rules — Quick Reference

**Monochrome only** in widget and Quick Chat. No color accent.

| Location | Color |
|---|---|
| Recording widget dot | White (`rgba(255,255,255,0.88)`) |
| Recording widget waveform | White (varying opacity per mode) |
| Recording widget glow | White glow (soft or bright) |
| Quick Chat — unmute dot | White (`rgba(255,255,255,0.70)`) |
| Quick Chat — source links | Muted white (`rgba(255,255,255,0.60)`) |
| Quick Chat — send button | White circle, dark icon |
| Quick Chat — user bubble | White-tinted glass |
| Quick Chat — assistant bubble | Near-invisible glass |
| Quick Chat — input focus ring | White (`rgba(255,255,255,0.22)`) |
| Quick Chat — borders | White-alpha borders |
| Errors only | `#FF4444` (semantic, not accent) |
| Success only | `#00C896` (semantic) |
| Warnings only | `#FFAA33` (semantic) |

---

## Reference Apps

| App | What We Take |
|---|---|
| **Wispr Flow** | Invisible-until-needed philosophy. Small floating bar. Waveform feedback. Muscle memory over visual cues. |
| **Arc Browser** | Rounded warmth. Clean negative space. Muted colors with bright accents. Playful but professional. |
| **Raycast** | Dark glass command bar. Tight spacing. Keyboard-first but beautiful. |
| **macOS Liquid Glass** | Blur + transparency as a material. Inner glow on edges. Content shows through. |

---

*This design system is a living document. Update it as unmute evolves.*