/*
 * <knr-slider> : complète un slider en scroll-snap natif (CSS).
 * - [data-knr-slider-track] : la liste qui défile (obligatoire)
 * - [data-knr-slider-progress] : barre de progression (optionnelle)
 * - [data-knr-slider-prev] / [data-knr-slider-next] : boutons précédent / suivant (optionnels)
 * - [data-knr-slider-dot] : un bouton par élément, le bouton actif reçoit aria-current (optionnels)
 * Sans JS, le slider reste utilisable au swipe / au scroll.
 */
class KnrSlider extends HTMLElement {
  connectedCallback() {
    this.track = this.querySelector('[data-knr-slider-track]');
    if (!this.track) return;

    this.progress = this.querySelector('[data-knr-slider-progress]');
    this.prevButton = this.querySelector('[data-knr-slider-prev]');
    this.nextButton = this.querySelector('[data-knr-slider-next]');
    this.dots = [...this.querySelectorAll('[data-knr-slider-dot]')];

    this.controller = new AbortController();
    const { signal } = this.controller;

    this.track.addEventListener('scroll', () => this.update(), { passive: true, signal });
    this.prevButton?.addEventListener('click', () => this.scrollToIndex(this.currentIndex() - 1), { signal });
    this.nextButton?.addEventListener('click', () => this.scrollToIndex(this.currentIndex() + 1), { signal });
    this.dots.forEach((dot, index) => {
      dot.addEventListener('click', () => this.scrollToIndex(index), { signal });
    });

    this.update();
  }

  disconnectedCallback() {
    this.controller?.abort();
  }

  /* Largeur d'un élément + gap : le pas de défilement */
  itemStep() {
    const item = this.track.firstElementChild;
    if (!item) return 0;

    const gap = parseFloat(getComputedStyle(this.track).columnGap) || 0;
    return item.offsetWidth + gap;
  }

  currentIndex() {
    const step = this.itemStep();
    return step ? Math.round(this.track.scrollLeft / step) : 0;
  }

  scrollToIndex(index) {
    this.track.scrollTo({ left: index * this.itemStep(), behavior: 'smooth' });
  }

  update() {
    const { scrollLeft, clientWidth, scrollWidth } = this.track;
    if (!scrollWidth) return;

    if (this.progress) {
      const ratio = Math.min(1, (scrollLeft + clientWidth) / scrollWidth);
      this.progress.style.setProperty('--knr-slider-progress', `${ratio * 100}%`);
    }

    this.prevButton?.setAttribute('aria-disabled', String(scrollLeft <= 1));
    this.nextButton?.setAttribute('aria-disabled', String(scrollLeft + clientWidth >= scrollWidth - 1));

    if (this.dots.length) {
      const current = this.currentIndex();
      this.dots.forEach((dot, index) => {
        if (index === current) {
          dot.setAttribute('aria-current', 'true');
        } else {
          dot.removeAttribute('aria-current');
        }
      });
    }
  }
}

if (!customElements.get('knr-slider')) {
  customElements.define('knr-slider', KnrSlider);
}
