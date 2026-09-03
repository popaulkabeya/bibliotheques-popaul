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
 * @param {object} volume
 * @param {HTMLElement} stage
 * @param {object} ctx { url, saved, onTrack, onTime, persist }
 */
export function renderAudio(volume, stage, ctx) {
  const { url, saved, onTrack, onTime, persist } = ctx;
  const wrap = document.createElement('div');
  wrap.className = 'audio-wrap';
  wrap.innerHTML = `
    <h3>${echapper(volume.label)}</h3>
    <p>Enregistrement complet — ${volume.tracks.length} pistes. Disponible hors-ligne une fois le livre téléchargé.</p>
    <audio id="player" controls preload="metadata"></audio>
    <div id="tracks"></div>`;
  stage.replaceChildren(wrap);

  const player = wrap.querySelector('#player');
  const list = wrap.querySelector('#tracks');
  const name = (p) => decodeURIComponent(p.split('/').pop()).replace(/^\d+\s*-\s*/, '').replace(/\.mp3$/i, '');

  volume.tracks.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'track';
    row.innerHTML = `<span class="num">${String(i + 1).padStart(2, '0')}</span>
      <span class="nm">${echapper(name(t))}</span>
      <span class="sz">${volume.sizes?.[i] ? formatBytes(volume.sizes[i]) : ''}</span>`;
    row.addEventListener('click', () => play(i));
    list.appendChild(row);
  });

  let sauvegarde = null;

  const play = (i, depart = 0) => {
    player.src = url(volume.tracks[i]);
    // La position ne peut être posée qu'une fois la durée connue : l'affecter juste
    // après `src` reste sans effet, le média n'étant pas encore chargé.
    if (depart > 0) {
      player.addEventListener('loadedmetadata', () => {
        const d = player.duration;
        if (Number.isFinite(d) && depart < d - 1) player.currentTime = depart;
      }, { once: true });
    }
    player.play().catch(() => {});          // l'autoplay peut être refusé au 1er chargement
    [...list.children].forEach((r, j) => r.classList.toggle('playing', i === j));
    onTrack(i + 1);
    persist();
  };

  player.addEventListener('ended', () => {
    const suivante = [...list.children].findIndex((r) => r.classList.contains('playing')) + 1;
    if (suivante < volume.tracks.length) play(suivante);
  });

  // La position dans la piste est enregistrée : sur un enregistrement d'une heure,
  // reprendre au début serait décourageant.
  player.addEventListener('timeupdate', () => {
    if (!player.duration) return;
    onTime(player.currentTime);
    clearTimeout(sauvegarde);
    sauvegarde = setTimeout(persist, 4000);
  });

  // Un incident de lecture ne doit pas laisser l'écoute morte : on retente une fois
  // à l'endroit exact où elle s'est arrêtée.
  let reprises = 0;
  player.addEventListener('error', () => {
    const i = [...list.children].findIndex((r) => r.classList.contains('playing'));
    if (i < 0 || reprises >= 2) return;
    reprises++;
    const t = ctx.time() || 0;
    setTimeout(() => play(i, t), 800);
  });
  player.addEventListener('playing', () => { reprises = 0; });

  const reprise = saved || null;
  const piste = reprise && reprise.page ? Math.min(reprise.page - 1, volume.tracks.length - 1) : 0;
  play(piste, reprise?.audioTime || 0);
}

