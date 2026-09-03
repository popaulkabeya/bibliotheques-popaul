/**
 * sante.js — L'application interroge réellement sa source de livres, au lieu de se fier
 * à navigator.onLine, qui reste vrai quand seul le serveur local est arrêté.
 */

const $ = (id) => document.getElementById(id);
let signaler = () => {};
export function initSante(onToast) { signaler = onToast; }

let counter = 0;
let reprise = null;

/** Tant que la source est coupée, on la sonde régulièrement pour se rétablir seul. */
function surveillerRetour() {
  if (reprise) return;
  reprise = setInterval(verifierSource, 15000);
}
function arreterSurveillance() {
  if (reprise) { clearInterval(reprise); reprise = null; }
}

export async function verifierSource() {
  const pill = $('netPill');
  const txt = pill.querySelector('span');

  if (!navigator.onLine) {
    pill.className = 'net-pill off';
    txt.textContent = 'hors ligne';
    arreterSurveillance();
    pill.title = 'Aucune connexion. Seuls les livres téléchargés sont lisibles.';
    return;
  }
  try {
    const ctrl = new AbortController();
    const stop = setTimeout(() => ctrl.abort(), 4000);
    // `?ping` : le service worker laisse passer sans repli sur son cache.
    const r = await fetch(`src/data/catalog.json?ping=${counter++}`,
                          { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(stop);
    if (!r.ok) throw new Error(String(r.status));
    const revient = pill.classList.contains('ko');
    pill.className = 'net-pill';
    txt.textContent = 'en ligne';
    pill.title = 'La bibliothèque répond.';
    arreterSurveillance();
    if (revient) signaler('La bibliothèque répond de nouveau.');
  } catch {
    pill.className = 'net-pill ko';
    txt.textContent = 'source coupée';
    surveillerRetour();
    pill.title = "Le serveur de la bibliothèque ne répond pas. Relancez ./scripts/start.sh — " +
                 'en attendant, seuls les livres téléchargés sont lisibles.';
  }
}

