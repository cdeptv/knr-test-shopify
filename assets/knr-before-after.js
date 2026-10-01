/*
 * <knr-before-after> : comparateur avant / après.
 * Un <input type="range"> natif (souris, tactile, clavier, lecteurs d'écran)
 * met à jour --knr-position ; le CSS découpe l'image « avant » et place le trait et la poignée.
 */
class KnrBeforeAfter extends HTMLElement {
  connectedCallback() {
    this.range = this.querySelector('input[type="range"]');
    if (!this.range) return;

    this.update = this.update.bind(this);
    this.range.addEventListener('input', this.update);
    this.update();
  }

  disconnectedCallback() {
    this.range?.removeEventListener('input', this.update);
  }

  update() {
    this.style.setProperty('--knr-position', `${this.range.value}%`);
  }
}

if (!customElements.get('knr-before-after')) {
  customElements.define('knr-before-after', KnrBeforeAfter);
}
