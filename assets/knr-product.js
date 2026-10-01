/*
 * <knr-product-info> : sélecteur de variantes (amélioration progressive).
 * Sans JS, chaque taille est un lien ?variant=ID qui recharge la page.
 * Avec JS, on récupère la section re-rendue par Shopify (Section Rendering API)
 * et on remplace les zones qui dépendent de la variante : aucun prix n'est calculé ici.
 * Plusieurs <knr-product-info> peuvent coexister (fiche produit, carte de la section Engagement) :
 * un changement de variante dans l'un est répercuté dans les autres.
 */
const KNR_VARIANT_AREAS = ['KnrPrice', 'KnrVariants', 'KnrBuy', 'KnrCard'];

class KnrProductInfo extends HTMLElement {
  connectedCallback() {
    this.sectionId = this.dataset.sectionId;
    this.onClick = this.onClick.bind(this);
    this.onVariantChange = this.onVariantChange.bind(this);
    this.addEventListener('click', this.onClick);
    document.addEventListener('knr:variant-change', this.onVariantChange);
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.onClick);
    document.removeEventListener('knr:variant-change', this.onVariantChange);
    this.controller?.abort();
  }

  onClick(event) {
    const link = event.target.closest('a[data-knr-variant-link]');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    event.preventDefault();
    if (link.getAttribute('aria-current') === 'true') return;

    // Zone d'origine du clic, pour y replacer le focus après remplacement
    const focusAreaId = KNR_VARIANT_AREAS.map((prefix) => `${prefix}-${this.sectionId}`).find((id) => link.closest(`#${id}`));
    this.renderVariant(link.href, focusAreaId);
  }

  // Variante choisie dans une autre section : mise à jour silencieuse
  onVariantChange(event) {
    if (event.detail.source !== this) this.renderVariant(event.detail.href, null, true);
  }

  async renderVariant(href, focusAreaId, silent = false) {
    this.controller?.abort();
    this.controller = new AbortController();

    const url = new URL(href);
    url.searchParams.set('section_id', this.sectionId);

    try {
      const response = await fetch(url, { signal: this.controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const html = new DOMParser().parseFromString(await response.text(), 'text/html');

      KNR_VARIANT_AREAS.forEach((prefix) => {
        const id = `${prefix}-${this.sectionId}`;
        const current = document.getElementById(id);
        const next = html.getElementById(id);
        if (current && next) current.replaceWith(next);
      });

      if (silent) return;

      window.history.replaceState({}, '', href);
      document.getElementById(focusAreaId)?.querySelector('[aria-current="true"]')?.focus();
      document.dispatchEvent(new CustomEvent('knr:variant-change', { detail: { href, source: this } }));
    } catch (error) {
      // En cas d'échec, on retombe sur le comportement natif : navigation vers la variante.
      if (error.name !== 'AbortError' && !silent) window.location.assign(href);
    }
  }
}

if (!customElements.get('knr-product-info')) {
  customElements.define('knr-product-info', KnrProductInfo);
}

/*
 * <knr-delivery-date data-days="2"> : date de livraison estimée.
 * Aujourd'hui + N jours ouvrés (samedis et dimanches exclus), au format de la langue de la page
 * (« Mercredi 25 février »). Calculée côté navigateur pour rester juste même si la page est en cache.
 * Sans JS, le texte rendu par Liquid reste affiché (« sous N jours ouvrés »).
 */
class KnrDeliveryDate extends HTMLElement {
  connectedCallback() {
    const days = parseInt(this.dataset.days, 10);
    if (!days) return;

    const date = new Date();
    let remaining = days;
    while (remaining > 0) {
      date.setDate(date.getDate() + 1);
      const weekday = date.getDay();
      if (weekday !== 0 && weekday !== 6) remaining -= 1;
    }

    const locale = document.documentElement.lang || undefined;
    const label = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
    this.textContent = label.charAt(0).toUpperCase() + label.slice(1);
  }
}

if (!customElements.get('knr-delivery-date')) {
  customElements.define('knr-delivery-date', KnrDeliveryDate);
}
