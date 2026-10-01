/*
 * knr-footer :
 * 1. Menus : accordéons sur mobile (fermés), colonnes ouvertes et non repliables sur desktop.
 *    Rendus ouverts par Liquid : sans JS, tous les liens restent visibles.
 * 2. Pays / langue : envoi du formulaire de localisation dès qu'une valeur change.
 */
(() => {
  const menus = document.querySelectorAll('[data-knr-footer-menu]');
  const desktop = window.matchMedia('(min-width: 990px)');

  const sync = () => {
    menus.forEach((menu) => {
      const summary = menu.querySelector('summary');
      menu.open = desktop.matches;
      // Desktop : le titre n'est plus un bouton (hors tabulation, clic sans effet)
      if (desktop.matches) {
        summary?.setAttribute('tabindex', '-1');
      } else {
        summary?.removeAttribute('tabindex');
      }
    });
  };

  menus.forEach((menu) => {
    menu.querySelector('summary')?.addEventListener('click', (event) => {
      if (desktop.matches) event.preventDefault();
    });
  });

  desktop.addEventListener('change', sync);
  sync();

  document.querySelectorAll('[data-knr-autosubmit]').forEach((select) => {
    select.addEventListener('change', () => select.form?.submit());
  });
})();
