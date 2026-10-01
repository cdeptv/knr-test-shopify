/*
 * Tiroir de navigation mobile de knr-header (<details data-knr-header-drawer>).
 * Le details/summary gère l'ouverture et l'accessibilité ; ce script ajoute :
 * fermeture avec Échap (focus rendu au bouton), au clic en dehors, et au passage en desktop.
 */
(() => {
  const drawers = document.querySelectorAll('[data-knr-header-drawer]');
  if (!drawers.length) return;

  const close = (drawer, focus = false) => {
    if (!drawer.open) return;
    drawer.open = false;
    if (focus) drawer.querySelector('summary')?.focus();
  };

  drawers.forEach((drawer) => {
    drawer.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close(drawer, true);
    });
  });

  document.addEventListener('click', (event) => {
    drawers.forEach((drawer) => {
      if (!drawer.contains(event.target)) close(drawer);
    });
  });

  window.matchMedia('(min-width: 990px)').addEventListener('change', (event) => {
    if (event.matches) drawers.forEach((drawer) => close(drawer));
  });
})();
