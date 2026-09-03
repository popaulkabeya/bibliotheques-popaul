/**
 * dialogue.js — Confirmation dessinée par l'application, à la place de confirm().
 */

/**
 * Confirmation dessinée par l'application.
 *
 * `confirm()` du navigateur peut être écarté sans rien afficher — il renvoie alors
 * « non » en silence, et l'action semble ne rien faire. On ne s'y fie plus.
 * @returns {Promise<boolean>}
 */
export function demander({ titre, message, valider = 'Confirmer', annuler = 'Annuler', danger = false }) {
  return new Promise((resolve) => {
    const fond = document.createElement('div');
    fond.className = 'ask-wrap';
    fond.innerHTML = `
      <div class="ask" role="alertdialog" aria-modal="true" aria-label="${escapeAttr(titre)}">
        <h3>${escapeAttr(titre)}</h3>
        <p>${escapeAttr(message)}</p>
        <div class="ask-actions">
          <button class="act" data-non>${escapeAttr(annuler)}</button>
          <button class="act ${danger ? 'danger' : 'primary'}" data-oui>${escapeAttr(valider)}</button>
        </div>
      </div>`;
    document.body.appendChild(fond);

    const fermer = (reponse) => {
      document.removeEventListener('keydown', auClavier);
      fond.remove();
      resolve(reponse);
    };
    const auClavier = (e) => {
      if (e.key === 'Escape') fermer(false);
      if (e.key === 'Enter') fermer(true);
    };
    fond.querySelector('[data-oui]').addEventListener('click', () => fermer(true));
    fond.querySelector('[data-non]').addEventListener('click', () => fermer(false));
    fond.addEventListener('click', (e) => { if (e.target === fond) fermer(false); });
    document.addEventListener('keydown', auClavier);
    fond.querySelector('[data-oui]').focus();
  });
}

const escapeAttr = (t) => String(t).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

