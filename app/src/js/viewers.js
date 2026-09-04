/**
 * viewers.js — Lecteurs autonomes : galerie de planches et livre audio.
 * Ne dépendent pas de l'état du lecteur : tout leur est passé en paramètre.
 */
import { formatBytes } from './store.js';

const echapper = (t) => String(t).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ═══════════════ Galerie ═══════════════ */

/** @param {object} volume @param {HTMLElement} stage @param {(p:string)=>string} url */
export function renderGallery(volume, stage, url) {
  const gal = document.createElement('div');
  gal.className = 'gal';
  gal.innerHTML = volume.images.map((img, i) => `
    <figure>
      <img src="${url(img)}" alt="Planche ${i + 1}" loading="lazy">
      <figcaption>Planche ${i + 1} — ${echapper(img.split('/').pop().replace(/\.jpg$/i, '').replace(/-/g, ' '))}</figcaption>
    </figure>`).join('');
  gal.addEventListener('click', (e) => {
    if (e.target.tagName !== 'IMG') return;
    const box = document.createElement('div');
    box.className = 'lightbox';
    box.innerHTML = `<img src="${e.target.src}" alt="">`;
    box.addEventListener('click', () => box.remove());
    document.body.appendChild(box);
  });
  stage.replaceChildren(gal);
}

/* ═══════════════ Audio ═══════════════ */

/**
 * Liste des pistes d'un livre audio. La lecture elle-même est déléguée au moteur
 * persistant (miniplayer.js) : fermer le lecteur ne doit pas couper le son.
 * @param {object} volume @param {HTMLElement} stage
 * @param {object} ctx { book, vIndex, mp, startTrack, startAt } — mp est le module miniplayer.js
 * @returns {() => void} à appeler quand la vue change, pour se désabonner
 */
export function renderAudio(volume, stage, ctx) {
  const { book, vIndex, mp } = ctx;
  const wrap = document.createElement('div');
  wrap.className = 'audio-wrap';
  wrap.innerHTML = `
    <h3>${echapper(volume.label)}</h3>
    <p>Enregistrement complet — ${volume.tracks.length} pistes. Disponible hors-ligne une fois le livre téléchargé.
       La lecture continue même si vous quittez cette page.</p>
    <div id="tracks"></div>`;
  stage.replaceChildren(wrap);

  const list = wrap.querySelector('#tracks');
  const nom = (p) => decodeURIComponent(p.split('/').pop()).replace(/^\d+\s*-\s*/, '').replace(/\.(mp3|m4a)$/i, '');

  volume.tracks.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'track';
    row.innerHTML = `<span class="num">${String(i + 1).padStart(2, '0')}</span>
      <span class="nm">${echapper(nom(t))}</span>
      <span class="sz">${volume.sizes?.[i] ? formatBytes(volume.sizes[i]) : ''}</span>`;
    row.addEventListener('click', () => mp.ouvrir(book, vIndex, volume, { trackIndex: i }));
    list.appendChild(row);
  });

  const majSurlignage = () => {
    const i = mp.estLeLivreCourant(book.id, vIndex) ? mp.instantane().trackIndex : -1;
    [...list.children].forEach((row, j) => row.classList.toggle('playing', j === i));
  };
  majSurlignage();
  const detacher = mp.onChange(majSurlignage);

  // Si ce volume n'est pas déjà en cours ailleurs, démarrer sur la piste enregistrée.
  if (!mp.estLeLivreCourant(book.id, vIndex)) {
    mp.ouvrir(book, vIndex, volume, { trackIndex: ctx.startTrack || 0, startAt: ctx.startAt || 0 });
  }

  return detacher;
}
