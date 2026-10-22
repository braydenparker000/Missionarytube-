// HtmlTextView: a text view whose w:html string (an Html.fromHtml subset) is
// shown with its inline <img src=…> drawables. Each image takes an em-wide
// slot in the text, so lines measure and wrap as plain text, and the icon is
// drawn into its slot (12dp, w:drawableTint, else the text colour). Other
// tags are dropped; <br> breaks the line. w:html_2 follows after a blank line.
import {FastTextView} from './text.js';
import {register} from './inflater.js';
import {colorForState} from '../res/resources.js';
import {colorToCss} from '../res/values.js';
import {iconSvg} from '../icons.js';

const SLOT = ' ';
const decode = s => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** Text and inline image names of an HTML string: {text, images}. */
export function parseHtml(html) {
  const images = [];
  const text = decode(String(html ?? '')
    .replace(/<img\s+src=["']?([\w.]+)["']?[^>]*>/gi, (m, src) => { images.push(src); return SLOT; })
    .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''));
  return {text: text.replace(/[ \t]+\n/g, '\n').trim(), images};
}

export class HtmlTextView extends FastTextView {
  constructor(ctx, a) {
    super(ctx, a);
    this.iconTint = a.color('drawableTint') ?? null;
    this.images = [];
    let html = a.string('html', null);
    // w:html_2: a second paragraph after a blank line.
    const html2 = a.string('html_2', null);
    if (html2 !== null) html = `${html ?? ''}<br><br>${html2}`;
    if (html !== null) this.setHtml(html);
  }

  setHtml(html) {
    const {text, images} = parseHtml(html);
    this.images = images;
    this._iconsKey = null;
    this.setText(text);
  }

  draw() {
    super.draw();
    if (!this.images.length || !this.textEl || this._iconsKey === this._textKey) return;
    this._iconsKey = this._textKey;
    const tint = this.iconTint ? colorForState(this.iconTint, this.state) : this.currentTextColor();
    const color = colorToCss(tint);
    const size = this.ctx.px(Math.round(12 * this.ctx.dpr));
    let k = 0;
    for (const el of this.textEl.children) {
      const parts = el.textContent.split(SLOT);
      if (parts.length === 1) continue;
      el.replaceChildren();
      parts.forEach((p, i) => {
        if (i > 0) {
          const slot = document.createElement('span');
          slot.style.cssText = `display:inline-block;width:1em;height:${size}px;vertical-align:-0.1em;text-align:center`;
          // The glyph's box is styled through the CSSOM: style-src 'self' refuses inline style attributes.
          const box = document.createElement('span');
          box.style.cssText = `display:inline-block;width:${size}px;height:${size}px`;
          box.innerHTML = iconSvg(this.images[k++] ?? 'placeholder', color);
          slot.appendChild(box);
          el.appendChild(slot);
        }
        if (p) el.appendChild(document.createTextNode(p));
      });
    }
  }
}

register(['HtmlTextView'], HtmlTextView);
