/** Painted Luna scrollbars, independent of host OS / overlay-scrollbar settings. */
export class XPScrollbars {
  constructor(scroller, host, invalidate) {
    this.scroller = scroller;
    this.invalidate = invalidate;
    this.axes = ['x', 'y'].map(axis => this.create(axis, host));
    const corner = document.createElement('div');
    corner.className = 'xp-scroll-corner';
    corner.setAttribute('aria-hidden', 'true');
    host.append(corner);
  }
  create(axis, host) {
    const horizontal = axis === 'x';
    const bar = document.createElement('div');
    bar.className = `xp-scrollbar ${horizontal ? 'horizontal' : 'vertical'}`;
    bar.setAttribute('role', 'scrollbar');
    bar.setAttribute('aria-label', `${horizontal ? 'Horizontal' : 'Vertical'} canvas scroll`);
    bar.setAttribute('aria-controls', 'scroller');
    bar.setAttribute('aria-orientation', horizontal ? 'horizontal' : 'vertical');
    bar.setAttribute('aria-valuemin', '0');
    bar.tabIndex = 0;
    bar.innerHTML = `<button class="scroll-arrow back" tabindex="-1" aria-label="Scroll ${horizontal ? 'left' : 'up'}"><i></i></button><div class="scroll-track"><div class="scroll-thumb"><i></i></div></div><button class="scroll-arrow forward" tabindex="-1" aria-label="Scroll ${horizontal ? 'right' : 'down'}"><i></i></button>`;
    host.append(bar);
    const track = bar.querySelector('.scroll-track'), thumb = bar.querySelector('.scroll-thumb');
    const a = {axis, horizontal, bar, track, thumb, max: 0, travel: 0, length: 0};
    const position = e => horizontal ? e.clientX : e.clientY;
    const field = horizontal ? 'scrollLeft' : 'scrollTop';
    const viewport = () => horizontal ? this.scroller.clientWidth : this.scroller.clientHeight;
    const scroll = amount => {
      this.scroller[field] = Math.max(0, Math.min(a.max, this.scroller[field] + amount));
      this.update(); this.invalidate();
    };
    const repeat = (element, step) => {
      let timeout, interval;
      const stop = () => {clearTimeout(timeout); clearInterval(interval);};
      element.addEventListener('pointerdown', e => {
        if (e.button !== 0 || !a.max || e.target.closest('.scroll-thumb')) return;
        e.preventDefault(); element.setPointerCapture(e.pointerId); step(e);
        timeout = setTimeout(() => {interval = setInterval(() => step(e), 65);}, 350);
      });
      for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) element.addEventListener(event, stop);
      window.addEventListener('blur', stop);
    };
    repeat(bar.querySelector('.back'), () => scroll(-16));
    repeat(bar.querySelector('.forward'), () => scroll(16));
    repeat(track, e => {
      const r = thumb.getBoundingClientRect(), p = position(e);
      const start = horizontal ? r.left : r.top, end = horizontal ? r.right : r.bottom;
      if (p < start) scroll(-viewport() * .9);
      else if (p > end) scroll(viewport() * .9);
    });
    let drag = null;
    thumb.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !a.max) return;
      e.preventDefault(); e.stopPropagation(); thumb.setPointerCapture(e.pointerId);
      drag = {position: position(e), scroll: this.scroller[field]};
    });
    thumb.addEventListener('pointermove', e => {
      if (!drag || !a.travel) return;
      this.scroller[field] = Math.max(0, Math.min(a.max, drag.scroll + (position(e) - drag.position) * a.max / a.travel));
      this.update(); this.invalidate();
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) thumb.addEventListener(event, () => drag = null);
    bar.addEventListener('keydown', e => {
      let amount;
      if (e.key === 'Home') amount = -a.max;
      else if (e.key === 'End') amount = a.max;
      else if (e.key === 'PageUp') amount = -viewport() * .9;
      else if (e.key === 'PageDown') amount = viewport() * .9;
      else if (e.key === (horizontal ? 'ArrowLeft' : 'ArrowUp')) amount = -16;
      else if (e.key === (horizontal ? 'ArrowRight' : 'ArrowDown')) amount = 16;
      if (amount !== undefined) {e.preventDefault(); e.stopPropagation(); scroll(amount);}
    });
    return a;
  }
  update() {
    for (const a of this.axes) {
      const viewport = a.horizontal ? this.scroller.clientWidth : this.scroller.clientHeight;
      const extent = a.horizontal ? this.scroller.scrollWidth : this.scroller.scrollHeight;
      const position = a.horizontal ? this.scroller.scrollLeft : this.scroller.scrollTop;
      const trackLength = a.horizontal ? a.track.clientWidth : a.track.clientHeight;
      a.max = Math.max(0, extent - viewport);
      a.length = Math.min(trackLength, Math.max(20, Math.round(trackLength * viewport / Math.max(1, extent))));
      a.travel = Math.max(0, trackLength - a.length);
      a.thumb.hidden = !a.max;
      a.bar.classList.toggle('inactive', !a.max);
      a.bar.setAttribute('aria-valuemax', String(a.max));
      a.bar.setAttribute('aria-valuenow', String(Math.round(position)));
      a.thumb.style[a.horizontal ? 'width' : 'height'] = a.length + 'px';
      a.thumb.style[a.horizontal ? 'left' : 'top'] = (a.max ? Math.round(position / a.max * a.travel) : 0) + 'px';
      for (const b of a.bar.querySelectorAll('button')) b.disabled = !a.max;
    }
  }
}
