/*
 * <knr-rotator> : fait défiler des messages superposés, un à la fois.
 * - [data-knr-rotator-slide] : les messages (le message visible porte data-active)
 * - [data-knr-rotator-dot] : un bouton par message, le bouton actif reçoit aria-current
 * Rotation automatique (data-interval, 5 s par défaut), en pause au survol et au focus,
 * arrêtée définitivement dès que l'utilisateur choisit un message,
 * désactivée si l'utilisateur a demandé à réduire les animations.
 * Sans JS, seul le premier message est affiché.
 */
class KnrRotator extends HTMLElement {
  connectedCallback() {
    this.slides = [...this.querySelectorAll('[data-knr-rotator-slide]')];
    this.dots = [...this.querySelectorAll('[data-knr-rotator-dot]')];
    if (this.slides.length < 2) return;

    this.index = 0;
    this.stopped = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.controller = new AbortController();
    const { signal } = this.controller;

    this.dots.forEach((dot, index) => {
      dot.addEventListener(
        'click',
        () => {
          this.stopped = true;
          this.pause();
          this.show(index);
        },
        { signal }
      );
    });

    this.addEventListener('mouseenter', () => this.pause(), { signal });
    this.addEventListener('mouseleave', () => this.play(), { signal });
    this.addEventListener('focusin', () => this.pause(), { signal });
    this.addEventListener(
      'focusout',
      (event) => {
        if (!this.contains(event.relatedTarget)) this.play();
      },
      { signal }
    );

    this.play();
  }

  disconnectedCallback() {
    this.controller?.abort();
    this.pause();
  }

  play() {
    if (this.stopped) return;
    this.pause();
    const interval = Number(this.dataset.interval) || 5000;
    this.timer = setInterval(() => this.show((this.index + 1) % this.slides.length), interval);
  }

  pause() {
    clearInterval(this.timer);
  }

  show(index) {
    this.slides[this.index]?.removeAttribute('data-active');
    this.dots[this.index]?.removeAttribute('aria-current');
    this.index = index;
    this.slides[index]?.setAttribute('data-active', '');
    this.dots[index]?.setAttribute('aria-current', 'true');
  }
}

if (!customElements.get('knr-rotator')) {
  customElements.define('knr-rotator', KnrRotator);
}
