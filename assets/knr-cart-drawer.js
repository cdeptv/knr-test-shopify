/*
 * <knr-cart-drawer> : panier coulissant gamifié (sections/knr-cart-drawer.liquid).
 *
 * Principe : Shopify reste la source de vérité. Ce script n'additionne aucun prix
 * et ne construit aucun état de panier. Il :
 *  1. intercepte les formulaires natifs (ajout au panier, quantité, suppression) ;
 *  2. les envoie à la Cart API en AJAX, en demandant au passage le HTML re-rendu
 *     du drawer et de l'en-tête (paramètre `sections` : Section Rendering API) ;
 *  3. remplace ce HTML dans la page.
 * Sans JavaScript, ces mêmes formulaires fonctionnent et mènent à /cart.
 */

class KnrCartDrawer extends HTMLElement {
  connectedCallback() {
    this.sectionId = this.dataset.sectionId;
    this.dialog = this.querySelector('dialog');
    this.live = this.querySelector('[data-knr-cart-live]');
    this.state = this.readState();
    this.busy = false;

    this.onSubmit = this.onSubmit.bind(this);
    this.onClick = this.onClick.bind(this);
    this.onPageShow = this.onPageShow.bind(this);
    this.onEditorEvent = this.onEditorEvent.bind(this);

    // Délégation sur document : les formulaires du drawer sont remplacés à chaque rendu
    document.addEventListener('submit', this.onSubmit);
    document.addEventListener('click', this.onClick);
    window.addEventListener('pageshow', this.onPageShow);
    // Fermeture effective (y compris forcée par le navigateur) : on remet l'état à zéro
    this.dialog.addEventListener('close', () => {
      this.dialog.classList.remove('is-closing');
      this.setExpanded(false);
    });
    // Échap : dans le panneau échantillons on revient au panier, sinon fermeture animée
    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      if (this.isPanelOpen()) this.closePanel();
      else this.close();
    });
    this.addEventListener('change', (event) => {
      if (event.target.matches('[data-knr-samples-form] input[type="checkbox"]')) this.updatePanel();
    });

    // Theme Editor : le drawer s'ouvre quand on sélectionne la section ou un de ses paliers
    ['shopify:section:select', 'shopify:section:deselect', 'shopify:block:select'].forEach((type) =>
      document.addEventListener(type, this.onEditorEvent),
    );

    // Le panier a pu changer hors du drawer (page /cart, autre onglet) : on vérifie les avantages
    this.setBusy(true);
    this.reconcile().finally(() => this.setBusy(false));
  }

  disconnectedCallback() {
    document.removeEventListener('submit', this.onSubmit);
    document.removeEventListener('click', this.onClick);
    window.removeEventListener('pageshow', this.onPageShow);
    ['shopify:section:select', 'shopify:section:deselect', 'shopify:block:select'].forEach((type) =>
      document.removeEventListener(type, this.onEditorEvent),
    );
  }

  /* ---------- Ouverture / fermeture ---------- */

  open() {
    if (this.dialog.open) return;
    this.dialog.classList.remove('is-closing');
    // Largeur de la barre de défilement, compensée en CSS pendant que la page est bloquée
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.documentElement.style.setProperty('--knr-scrollbar-width', `${scrollbarWidth}px`);
    this.dialog.showModal(); // top layer, fond inerte, Échap natif, focus dans le dialog
    this.setExpanded(true);
  }

  /**
   * Fermeture animée, symétrique de l'ouverture : la classe is-closing lance le slide vers la droite
   * (CSS), et le <dialog> n'est réellement fermé qu'à la fin de l'animation.
   * Sans animation (prefers-reduced-motion), fermeture immédiate.
   */
  close() {
    if (!this.dialog.open || this.dialog.classList.contains('is-closing')) return;

    const animated = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!animated) {
      this.dialog.close();
      this.setExpanded(false);
      return;
    }

    this.dialog.classList.add('is-closing');
    // Fin de l'animation, ou délai de secours (onglet en arrière-plan : les animations n'y tournent pas)
    const finish = () => {
      window.clearTimeout(timer);
      this.dialog.removeEventListener('animationend', onEnd);
      if (this.dialog.open) this.dialog.close(); // le navigateur rend le focus à l'élément d'origine
      this.dialog.classList.remove('is-closing');
      this.setExpanded(false);
    };
    const onEnd = (event) => {
      if (event.target === this.dialog) finish(); // ignore les animations des enfants
    };
    const timer = window.setTimeout(finish, 400);
    this.dialog.addEventListener('animationend', onEnd);
  }

  setExpanded(expanded) {
    document.querySelectorAll('[data-knr-cart-toggle]').forEach((toggle) => {
      toggle.setAttribute('aria-expanded', String(expanded));
    });
  }

  onClick(event) {
    const toggle = event.target.closest('[data-knr-cart-toggle]');
    if (toggle && !this.isModifiedClick(event)) {
      event.preventDefault();
      this.open();
      return;
    }

    if (event.target.closest('[data-knr-samples-open]')) {
      this.openPanel();
      return;
    }

    if (event.target.closest('[data-knr-samples-close]')) {
      this.closePanel();
      return;
    }

    if (event.target.closest('[data-knr-cart-close]')) {
      this.close();
      return;
    }

    // Un clic sur le fond (::backdrop) a pour cible le <dialog> lui-même
    if (event.target === this.dialog) this.close();
  }

  isModifiedClick(event) {
    return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  }

  onEditorEvent(event) {
    if (event.detail.sectionId !== this.sectionId) return;
    if (event.type === 'shopify:section:deselect') this.close();
    else this.open();
  }

  /* ---------- Formulaires : ajout, quantité, suppression ---------- */

  onSubmit(event) {
    const form = event.target;
    if (form.matches('[data-knr-samples-form]')) {
      event.preventDefault();
      if (!this.busy) this.submitSamples(form, event.submitter);
      return;
    }

    const isAdd = form.matches('[data-knr-cart-add]');
    if (!isAdd && !form.matches('[data-knr-cart-line]')) return;

    event.preventDefault();
    if (this.busy) return;

    // FormData(form, submitter) inclut le name/value du bouton cliqué (quantity, updates[clé]…)
    const formData = new FormData(form, event.submitter);
    const action = form.getAttribute('action');
    const increment = isAdd ? this.getIncrement(formData) : null;

    const { submitter } = event;
    if (increment) {
      this.submit(increment.action, increment.body, { submitter, openAfter: true, fallback: { action, formData } });
    } else {
      this.submit(action, formData, { submitter, openAfter: isAdd });
    }
  }

  /**
   * Variante déjà présente dans une ligne payante : on augmente sa quantité (/cart/change)
   * au lieu d'ajouter (/cart/add), qui pourrait créer une 2e ligne identique à l'écran
   * (clé de ligne différente quand la ligne existante porte une allocation de remise).
   * @returns {{action: string, body: FormData} | null}
   */
  getIncrement(formData) {
    const hasProperties = [...formData.keys()].some((name) => name.startsWith('properties['));
    const variantId = Number(formData.get('id'));
    const line = !hasProperties && this.state?.lines?.find((item) => item.variantId === variantId);
    if (!line) return null;

    const body = new FormData();
    body.append('id', line.key);
    body.append('quantity', line.quantity + Number(formData.get('quantity') || 1));
    return { action: window.routes?.cart_change_url || '/cart/change', body };
  }

  /**
   * Action de l'utilisateur : mutation du panier, re-rendu, puis vérification des avantages.
   * @param {string} action  URL du formulaire natif (/cart/add, /cart/change, /cart/update)
   * @param {FormData} formData  données du formulaire
   */
  async submit(action, formData, { submitter = null, openAfter = false, fallback = null } = {}) {
    this.setBusy(true, submitter);
    // Référence pour détecter un palier débloqué, conservée pendant les corrections automatiques
    this.stateBeforeAction = this.state;

    try {
      const data = await this.request(action, formData);
      this.render(data.sections);
      if (openAfter) this.open();
      if (typeof publish === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
        publish(PUB_SUB_EVENTS.cartUpdate, { source: 'knr-cart-drawer', cartData: data });
      }
      await this.reconcile();
    } catch (error) {
      if (fallback) {
        // L'incrément a échoué (ligne modifiée entre-temps) : on refait un ajout classique
        this.setBusy(false, submitter);
        await this.submit(fallback.action, fallback.formData, { submitter, openAfter });
        return;
      }
      if (error.isCartError) {
        // 422 : variante épuisée, quantité indisponible… message fourni par Shopify
        this.showError(error.message);
        if (openAfter) this.open();
      } else {
        // Réseau coupé ou réponse inattendue : on retombe sur la soumission native
        console.error('[knr-cart-drawer]', error);
        this.fallbackSubmit(action, formData);
      }
    } finally {
      this.stateBeforeAction = null;
      this.setBusy(false, submitter);
    }
  }

  /**
   * Appel Cart API + Section Rendering API.
   * @param {string} action  /cart/add, /cart/change ou /cart/update (sans .js)
   * @param {FormData|Object} body  FormData d'un formulaire, ou objet envoyé en JSON
   * @returns {Promise<Object>} JSON de Shopify, avec `sections` : { [sectionId]: html }
   */
  async request(action, body) {
    const sections = this.getSectionIds().join(',');
    const isJson = !(body instanceof FormData);
    if (isJson) {
      body = JSON.stringify({ ...body, sections, sections_url: window.location.pathname });
    } else {
      body.append('sections', sections);
      body.append('sections_url', window.location.pathname);
    }

    // /cart/change → /cart/change.js : même endpoint, réponse JSON au lieu d'une redirection
    const response = await fetch(`${action}.js`, {
      method: 'POST',
      headers: isJson
        ? { Accept: 'application/json', 'Content-Type': 'application/json' }
        : { Accept: 'application/json' },
      body,
    });
    const data = await response.json();

    if (!response.ok) {
      const error = new Error(data.description || data.message);
      error.isCartError = true;
      throw error;
    }
    return data;
  }

  /* ---------- Avantages automatiques (réconciliation) ---------- */

  /**
   * Compare l'état calculé par Liquid avec le contenu du panier et envoie, si besoin,
   * UNE requête corrective. Après son rendu, on revérifie (un retrait peut précéder un ajout),
   * avec une profondeur maximale : aucune boucle possible, même si Shopify refuse une correction.
   */
  async reconcile(depth = 0) {
    if (depth > 2 || !this.state) return;

    const correction = this.getCorrection(this.state);
    if (!correction) return;

    try {
      const data = await this.request(correction.action, correction.body);
      this.render(data.sections);
      await this.reconcile(depth + 1);
    } catch (error) {
      // Cadeau refusé par Shopify (épuisé entre-temps…) : on ne réessaie pas pendant cette visite
      if (correction.giftVariantId) this.failedGiftId = correction.giftVariantId;
      console.warn('[knr-cart-drawer] correction impossible :', error.message);
    }
  }

  /**
   * Décide de la correction à appliquer. Tous les retraits partent dans UNE requête /cart/update,
   * les ajouts (cadeau) passent après, au tour suivant.
   * @returns {{action: string, body: FormData, giftVariantId?: number} | null}
   */
  getCorrection({ gift, samples }) {
    const routes = window.routes || {};
    const updates = {};
    const attributes = {};

    // 1. Échantillons : palier perdu, échantillon retiré de la liste ou épuisé,
    //    surplus (maximum abaissé dans l'éditeur), quantité > 1 (doublon)
    const kept = samples.lines.filter((line) => {
      if (!samples.unlocked || !line.valid) updates[line.key] = 0;
      return samples.unlocked && line.valid;
    });
    kept.forEach((line, index) => {
      if (index >= samples.max) updates[line.key] = 0;
      else if (line.quantity > 1) updates[line.key] = 1;
    });

    // 2. Cadeau : palier perdu, ou produit offert remplacé dans le Theme Editor
    if (gift.lineKey && (!gift.unlocked || gift.lineVariantId !== gift.variantId)) updates[gift.lineKey] = 0;
    // Palier perdu : on oublie le refus, le cadeau sera reproposé au prochain passage du seuil
    if (!gift.unlocked && gift.declined) attributes._knr_gift_declined = '';

    if (Object.keys(updates).length || Object.keys(attributes).length) {
      const body = new FormData();
      Object.entries(updates).forEach(([key, quantity]) => body.append(`updates[${key}]`, quantity));
      Object.entries(attributes).forEach(([name, value]) => body.append(`attributes[${name}]`, value));
      return { action: routes.cart_update_url || '/cart/update', body };
    }

    // 3. Ajout du cadeau : palier atteint, absent, non refusé par le client, disponible
    const addGift =
      gift.unlocked &&
      !gift.lineKey &&
      !gift.declined &&
      gift.variantId &&
      gift.available &&
      this.failedGiftId !== gift.variantId;

    if (addGift) {
      const body = new FormData();
      body.append('id', gift.variantId);
      body.append('quantity', '1');
      body.append('properties[_knr_perk]', 'gift');
      return { action: routes.cart_add_url || '/cart/add', body, giftVariantId: gift.variantId };
    }

    return null;
  }

  /* ---------- Panneau de sélection des échantillons ---------- */

  get panel() {
    return this.querySelector('[data-knr-samples-panel]');
  }

  isPanelOpen() {
    return Boolean(this.panel && !this.panel.hidden);
  }

  openPanel() {
    if (!this.panel) return;
    this.panel.hidden = false;
    this.querySelector('[data-knr-samples-open]')?.setAttribute('aria-expanded', 'true');
    this.updatePanel(false);
    this.panel.querySelector('#KnrSamplesTitle')?.focus();
  }

  // Retour sans valider : on annule les cases cochées (form.reset() revient à l'état rendu par Liquid)
  closePanel() {
    if (!this.panel) return;
    this.panel.querySelector('form')?.reset();
    this.panel.hidden = true;
    const opener = this.querySelector('[data-knr-samples-open]');
    opener?.setAttribute('aria-expanded', 'false');
    opener?.focus();
  }

  /**
   * Compteurs « n/max » et maximum : au-delà, les cases non cochées sont désactivées.
   * Les échantillons épuisés restent désactivés (attribut rendu par Liquid, mémorisé une fois).
   */
  updatePanel(announce = true) {
    const form = this.panel?.querySelector('form');
    if (!form) return;
    const max = Number(form.dataset.max);
    const inputs = [...form.querySelectorAll('input[type="checkbox"]')];
    inputs.forEach((input) => {
      if (input.dataset.soldOut === undefined) input.dataset.soldOut = String(input.disabled);
    });

    const count = inputs.filter((input) => input.checked).length;
    inputs.forEach((input) => {
      input.disabled = input.dataset.soldOut === 'true' || (!input.checked && count >= max);
    });
    form.querySelectorAll('[data-knr-samples-count]').forEach((counter) => {
      counter.textContent = count;
    });
    if (announce) this.announce(form.dataset.status.replace('[count]', count));
  }

  /**
   * Valide la sélection : compare les cases cochées aux lignes « échantillon » du panier.
   * Retraits : /cart/update (une requête). Ajouts : /cart/add avec items[] (une requête).
   */
  async submitSamples(form, submitter) {
    const selected = new FormData(form).getAll('sample').map(Number);
    const lines = this.state?.samples.lines || [];
    const inCart = lines.map((line) => line.variantId);

    const removals = new FormData();
    lines
      .filter((line) => !selected.includes(line.variantId))
      .forEach((line) => removals.append(`updates[${line.key}]`, 0));
    const additions = selected
      .filter((variantId) => !inCart.includes(variantId))
      .map((variantId) => ({ id: variantId, quantity: 1, properties: { _knr_perk: 'sample' } }));

    const routes = window.routes || {};
    this.setBusy(true, submitter);
    try {
      let data = null;
      if ([...removals.keys()].length) data = await this.request(routes.cart_update_url || '/cart/update', removals);
      if (additions.length) data = await this.request(routes.cart_add_url || '/cart/add', { items: additions });

      // Le HTML re-rendu par Shopify contient le panneau fermé ; sans requête, on le ferme nous-mêmes
      if (data) this.render(data.sections);
      else this.closePanel();
      this.querySelector('[data-knr-samples-open]')?.focus();
      await this.reconcile();
    } catch (error) {
      // Les retraits ont pu passer avant l'échec des ajouts : on resynchronise avec le vrai panier
      await this.refresh();
      this.showError(error.message);
    } finally {
      this.setBusy(false, submitter);
    }
  }

  fallbackSubmit(action, formData) {
    const form = document.createElement('form');
    form.method = 'post';
    form.action = action;
    formData.forEach((value, name) => {
      if (name === 'sections' || name === 'sections_url') return;
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      form.append(input);
    });
    document.body.append(form);
    form.submit();
  }

  setBusy(busy, submitter) {
    this.busy = busy;
    this.querySelector('.knr-cart__inner')?.setAttribute('aria-busy', String(busy));
    submitter?.setAttribute('aria-busy', String(busy));
  }

  /* ---------- Rendu (Section Rendering API) ---------- */

  getSectionIds() {
    const ids = [this.sectionId];
    const header = document.querySelector('[data-knr-cart-toggle][data-section-id]');
    if (header) ids.push(header.dataset.sectionId);
    return ids;
  }

  /**
   * Remplace le contenu du drawer et la pastille de l'en-tête par le HTML rendu par Shopify.
   * @param {Object<string, string>} sections  { [sectionId]: html }
   */
  render(sections) {
    if (!sections) return;
    const html = sections[this.sectionId];
    if (!html) return;

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const current = this.querySelector('.knr-cart__inner');
    const next = doc.querySelector('.knr-cart__inner');
    if (!current || !next) return;

    const previous = this.stateBeforeAction || this.state;
    const focusKey = document.activeElement?.closest('[data-knr-focus]')?.dataset.knrFocus;
    const focusWasInside = current.contains(document.activeElement);

    current.replaceWith(next);
    this.state = this.readState();
    this.showUnlockedMessage(previous, this.state);
    this.announce();
    if (focusWasInside) this.restoreFocus(focusKey);

    // Pastille de l'en-tête : on ne remplace que le contenu du lien panier
    const toggle = document.querySelector('[data-knr-cart-toggle][data-section-id]');
    const headerHtml = toggle && sections[toggle.dataset.sectionId];
    if (headerHtml) {
      const nextToggle = new DOMParser()
        .parseFromString(headerHtml, 'text/html')
        .querySelector('[data-knr-cart-toggle]');
      if (nextToggle) toggle.innerHTML = nextToggle.innerHTML;
    }
  }

  // État calculé par Liquid (paliers atteints, échantillons, cadeau)
  readState() {
    const script = this.querySelector('[data-knr-cart-state]');
    try {
      return script ? JSON.parse(script.textContent) : null;
    } catch {
      return null;
    }
  }

  // Un palier vient d'être débloqué : on affiche son message « après » à la place du « avant » suivant
  showUnlockedMessage(previous, current) {
    if (!previous || !current || current.reachedCount <= previous.reachedCount) return;
    const message = this.querySelector('.knr-cart__message');
    if (message && current.unlockedMessage) message.innerHTML = current.unlockedMessage;
  }

  // Les lecteurs d'écran annoncent le nouveau message de progression (région aria-live)
  announce(text) {
    if (!this.live) return;
    const message = text ?? this.querySelector('.knr-cart__message')?.textContent.trim() ?? '';
    // Vider puis remplir après un court délai : les lecteurs d'écran annoncent même un texte identique
    this.live.textContent = '';
    window.setTimeout(() => {
      this.live.textContent = message;
    }, 100);
  }

  // Le bouton cliqué a été remplacé : on remet le focus sur son équivalent, sinon sur le titre
  restoreFocus(focusKey) {
    let target = focusKey && this.querySelector(`[data-knr-focus="${CSS.escape(focusKey)}"]`);
    if (target?.disabled) target = target.parentElement.querySelector('[data-knr-focus]:not(:disabled)');
    (target || this.querySelector('#KnrCartTitle'))?.focus();
  }

  showError(message) {
    const error = this.querySelector('[data-knr-cart-error]');
    if (error) {
      error.textContent = message;
      error.hidden = false;
    }
    this.announce(message);
  }

  /* ---------- Retour arrière (cache du navigateur) ---------- */

  // Page restaurée depuis le bfcache : le panier a pu changer entre-temps, on re-rend le drawer
  async onPageShow(event) {
    if (!event.persisted) return;
    await this.refresh();
    this.reconcile();
  }

  // Re-rend le drawer et l'en-tête depuis Shopify, sans modifier le panier (Section Rendering API en GET)
  async refresh() {
    const ids = this.getSectionIds().join(',');
    const response = await fetch(`${window.location.pathname}?sections=${ids}`);
    if (response.ok) this.render(await response.json());
  }
}

if (!customElements.get('knr-cart-drawer')) {
  customElements.define('knr-cart-drawer', KnrCartDrawer);
}
