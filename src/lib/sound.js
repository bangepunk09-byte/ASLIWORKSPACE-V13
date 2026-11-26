// Web Audio API Synthesizer for high-fidelity UI sound effects without external network dependencies

let audioCtx = null;

function getAudioContext() {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export const isSoundEnabled = () => {
  if (typeof window === "undefined") return true;
  return localStorage.getItem("circle_sound_effects") !== "disabled";
};

export const setSoundEnabled = (enabled) => {
  if (typeof window === "undefined") return;
  localStorage.setItem("circle_sound_effects", enabled ? "enabled" : "disabled");
};

let lastBbmSoundAt = 0;

export function playSound(type = "click") {
  if (!isSoundEnabled()) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    switch (type) {
      case "bbm":
      case "message_notif": {
        // Classic BlackBerry Messenger (BBM) crystalline 3-note chime
        const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
        if (nowMs - lastBbmSoundAt < 350) return;
        lastBbmSoundAt = nowMs;

        const notes = [
          { freq: 1046.5, delay: 0.0, dur: 0.14, gain: 0.15 },   // C6
          { freq: 1318.51, delay: 0.082, dur: 0.16, gain: 0.16 }, // E6
          { freq: 1567.98, delay: 0.165, dur: 0.34, gain: 0.18 }, // G6
        ];

        notes.forEach(({ freq, delay, dur, gain: peak }) => {
          const t0 = now + delay;

          // Primary glassy sine chime
          const osc1 = ctx.createOscillator();
          const g1 = ctx.createGain();
          osc1.type = "sine";
          osc1.frequency.setValueAtTime(freq, t0);
          g1.gain.setValueAtTime(0.001, t0);
          g1.gain.linearRampToValueAtTime(peak, t0 + 0.004);
          g1.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
          osc1.connect(g1);
          g1.connect(ctx.destination);
          osc1.start(t0);
          osc1.stop(t0 + dur + 0.02);

          // Harmonic bell overtone (2x shimmer, faster decay)
          const osc2 = ctx.createOscillator();
          const g2 = ctx.createGain();
          osc2.type = "sine";
          osc2.frequency.setValueAtTime(freq * 2.003, t0);
          g2.gain.setValueAtTime(0.001, t0);
          g2.gain.linearRampToValueAtTime(peak * 0.28, t0 + 0.003);
          g2.gain.exponentialRampToValueAtTime(0.0008, t0 + Math.min(0.11, dur * 0.65));
          osc2.connect(g2);
          g2.connect(ctx.destination);
          osc2.start(t0);
          osc2.stop(t0 + Math.min(0.13, dur * 0.7));

          // Crisp percussive plink transient
          const osc3 = ctx.createOscillator();
          const g3 = ctx.createGain();
          osc3.type = "triangle";
          osc3.frequency.setValueAtTime(freq * 3, t0);
          g3.gain.setValueAtTime(peak * 0.14, t0);
          g3.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.024);
          osc3.connect(g3);
          g3.connect(ctx.destination);
          osc3.start(t0);
          osc3.stop(t0 + 0.028);
        });
        break;
      }

      case "message": {
        // Warm dual-tone pop
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.08); // A5
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.15);
        break;
      }

      case "task_done": {
        // Triumphant ascending triad chord (C5 - E5 - G5)
        [523.25, 659.25, 783.99].forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, now + idx * 0.06);
          gain.gain.setValueAtTime(0.12, now + idx * 0.06);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.3);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + idx * 0.06);
          osc.stop(now + idx * 0.06 + 0.32);
        });
        break;
      }

      case "task_create": {
        // Crisp bubble pop
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.07);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.11);
        break;
      }

      case "notification": {
        // Elegant marimba chime
        [659.25, 987.77].forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, now + idx * 0.09);
          gain.gain.setValueAtTime(0.15, now + idx * 0.09);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.09 + 0.35);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + idx * 0.09);
          osc.stop(now + idx * 0.09 + 0.36);
        });
        break;
      }

      case "meeting": {
        // Soft bell harmony for calendar & schedule
        [440, 554.37, 659.25].forEach((freq) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, now);
          gain.gain.setValueAtTime(0.08, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.42);
        });
        break;
      }

      case "post": {
        // Smooth uplifting pop + warm harmonic chime when publishing a post
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = "sine";
        osc1.frequency.setValueAtTime(523.25, now); // C5
        osc1.frequency.exponentialRampToValueAtTime(783.99, now + 0.09); // G5
        gain1.gain.setValueAtTime(0.14, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.23);

        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = "triangle";
        osc2.frequency.setValueAtTime(1046.5, now + 0.055); // C6 soft sparkle
        gain2.gain.setValueAtTime(0.07, now + 0.055);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now + 0.055);
        osc2.stop(now + 0.27);
        break;
      }

      case "pop": {
        // Light bubbly pop for reactions, pins, tags, and quick toggles
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(420, now);
        osc.frequency.exponentialRampToValueAtTime(760, now + 0.055);
        gain.gain.setValueAtTime(0.11, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.09);
        break;
      }

      case "check": {
        // Crisp upward checkmark tick
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(587.33, now);
        osc.frequency.exponentialRampToValueAtTime(987.77, now + 0.06);
        gain.gain.setValueAtTime(0.11, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.12);
        break;
      }

      case "uncheck": {
        // Soft downward tick when unchecking an item
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(620, now);
        osc.frequency.exponentialRampToValueAtTime(380, now + 0.06);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.1);
        break;
      }

      case "tab": {
        // Ultra-light switch tick for navigation & tab changes
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(660, now);
        osc.frequency.exponentialRampToValueAtTime(500, now + 0.032);
        gain.gain.setValueAtTime(0.045, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.05);
        break;
      }

      case "trash":
      case "delete": {
        // Gentle low swoosh-thud for deleting items or chats
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(280, now);
        osc.frequency.exponentialRampToValueAtTime(110, now + 0.12);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.15);
        break;
      }

      case "archive": {
        // Warm settle tone for archiving/restoring items
        [493.88, 392.0].forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, now + idx * 0.055);
          gain.gain.setValueAtTime(0.085, now + idx * 0.055);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.055 + 0.14);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + idx * 0.055);
          osc.stop(now + idx * 0.055 + 0.15);
        });
        break;
      }

      case "success": {
        // Pleasant two-note confirmation chime
        [587.33, 880].forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, now + idx * 0.06);
          gain.gain.setValueAtTime(0.11, now + idx * 0.06);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.2);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + idx * 0.06);
          osc.stop(now + idx * 0.06 + 0.22);
        });
        break;
      }

      case "keyboard": {
        // Tactile mechanical keystroke click with subtle pitch variation
        const jitter = 0.94 + Math.random() * 0.12;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(920 * jitter, now);
        osc.frequency.exponentialRampToValueAtTime(240 * jitter, now + 0.024);
        gain.gain.setValueAtTime(0.055, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.028);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.032);
        break;
      }

      case "key_space": {
        // Deeper, fuller thock for Spacebar
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(165, now + 0.034);
        gain.gain.setValueAtTime(0.068, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.038);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.042);
        break;
      }

      case "key_enter": {
        // Crisp two-stage tactile return key click
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(640, now);
        osc.frequency.exponentialRampToValueAtTime(290, now + 0.038);
        gain.gain.setValueAtTime(0.072, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.044);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.048);
        break;
      }

      case "key_delete": {
        // Soft low tap for Backspace/Delete
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(480, now);
        osc.frequency.exponentialRampToValueAtTime(190, now + 0.026);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.034);
        break;
      }

      case "click":
      default: {
        // Subtle tactile UI tap
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(300, now + 0.04);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.06);
        break;
      }
    }
  } catch (err) {
    console.debug("Audio playback error:", err);
  }
}

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

const SILENT_KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "CapsLock",
  "Tab",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Insert",
  "ContextMenu",
  "NumLock",
  "ScrollLock",
  "Pause",
]);

let lastKeySoundAt = 0;

export function initKeyboardTypingSound() {
  if (typeof window === "undefined") return;
  if (window.__circleKeyboardSoundAttached) return;
  window.__circleKeyboardSoundAttached = true;

  window.addEventListener(
    "keydown",
    (e) => {
      if (!e || e.isComposing) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const target = e.target;
      if (!target || typeof target !== "object") return;
      const tag = (target.tagName || "").toUpperCase();
      const isInput =
        tag === "INPUT" &&
        !NON_TEXT_INPUT_TYPES.has(String(target.type || "text").toLowerCase()) &&
        !target.readOnly &&
        !target.disabled;
      const isTextarea = tag === "TEXTAREA" && !target.readOnly && !target.disabled;
      const isEditable = Boolean(target.isContentEditable);

      if (!isInput && !isTextarea && !isEditable) return;

      const key = String(e.key || "");
      if (!key || SILENT_KEYS.has(key) || /^F\d{1,2}$/.test(key)) return;

      const nowMs = performance.now();
      if (nowMs - lastKeySoundAt < 22) return;
      lastKeySoundAt = nowMs;

      if (key === " " || e.code === "Space") {
        playSound("key_space");
      } else if (key === "Enter") {
        playSound("key_enter");
      } else if (key === "Backspace" || key === "Delete") {
        playSound("key_delete");
      } else if (key.length === 1) {
        playSound("keyboard");
      }
    },
    true
  );
}

if (typeof window !== "undefined") {
  initKeyboardTypingSound();
}

