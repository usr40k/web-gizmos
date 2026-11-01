// Keyboard + touch input. Produces { throttle, steer, brake } and fires one-shot action callbacks.
export class Input {
  constructor(actions) {
    this.keys = new Set();
    this.touch = { up: false, down: false, left: false, right: false, brake: false };
    this.actions = actions;           // { interact(), menu(), chat(), tow(), garage() }
    this.enabled = true;
    addEventListener('keydown', (e) => this.key(e, true));
    addEventListener('keyup', (e) => this.key(e, false));
    addEventListener('blur', () => { this.keys.clear(); for (const k in this.touch) this.touch[k] = false; });
    this.bindTouch();
  }
  typing() { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'); }
  key(e, down) {
    if (this.typing()) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (down && !e.repeat) {
      if (k === 'e' || k === 'f') this.actions.interact();
      else if (k === 'Enter') { e.preventDefault(); this.actions.chat(); }
      else if (k === 'Escape') this.actions.menu();
      else if (k === 'g') this.actions.garage();
      else if (k === 't') this.actions.tow();
      else if (k === 'h') this.actions.hitch && this.actions.hitch();
    }
    if (!this.enabled && down) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(k)) e.preventDefault();
    if (down) this.keys.add(k); else this.keys.delete(k);
  }
  bindTouch() {
    for (const el of document.querySelectorAll('[data-touch]')) {
      const k = el.dataset.touch;
      const on = (v) => (e) => { e.preventDefault(); this.touch[k] = v; el.classList.toggle('down', v); };
      el.addEventListener('pointerdown', on(true)); el.addEventListener('pointerup', on(false));
      el.addEventListener('pointercancel', on(false)); el.addEventListener('pointerleave', on(false));
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }
  read() {
    if (!this.enabled) return { throttle: 0, steer: 0, brake: true };
    const K = this.keys, T = this.touch;
    const up = K.has('w') || K.has('ArrowUp') || T.up, down = K.has('s') || K.has('ArrowDown') || T.down;
    const left = K.has('a') || K.has('ArrowLeft') || T.left, right = K.has('d') || K.has('ArrowRight') || T.right;
    return { throttle: (up ? 1 : 0) - (down ? 1 : 0), steer: (right ? 1 : 0) - (left ? 1 : 0), brake: K.has(' ') || T.brake };
  }
}
