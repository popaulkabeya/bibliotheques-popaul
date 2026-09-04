/**
 * miniplayer-ui.js — Câblage de la barre du lecteur audio persistant.
 * La logique de lecture vit dans miniplayer.js ; ce module ne fait que refléter
 * son état à l'écran et relayer les clics.
 */
import * as mp from './miniplayer.js';

const $ = (id) => document.getElementById(id);
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, '0')}`; };

export function initMiniplayerUI({ onOpenBook }) {
  const bar = $('miniplayer');

  const render = () => {
    const s = mp.instantane();
    bar.hidden = !s.ouvert;
    if (!s.ouvert) return;
    $('mpTitle').textContent = s.book.title;
    $('mpSub').textContent = mp.nomPiste(s.volume.tracks[s.trackIndex]) || s.volume.label;
    $('mpPlay').textContent = s.enLecture ? '❚❚' : '▶';
    $('mpTime').textContent = `${fmt(s.currentTime)} / ${fmt(s.duree)}`;
    $('mpFill').style.width = s.duree ? `${(s.currentTime / s.duree) * 100}%` : '0%';
    $('mpRate').textContent = `${s.rate.toFixed(2).replace(/0$/, '').replace(/\.$/, '.0')}×`;
    $('mpSleep').classList.toggle('on', !!s.sleepAt || s.sleepFinPiste);
    document.querySelectorAll('#mpRatePanel [data-v]').forEach((b) => b.classList.toggle('on', +b.dataset.v === s.rate));
  };

  mp.onChange(render);
  render();
  setInterval(() => { if (!$('miniplayer').hidden) render(); }, 1000);   // avance le minutage entre deux « timeupdate »

  $('mpPlay').addEventListener('click', () => mp.toggle());
  $('mpPrev').addEventListener('click', () => mp.precedente());
  $('mpNext').addEventListener('click', () => mp.suivante());
  $('mpBack15').addEventListener('click', () => mp.sauter(-15));
  $('mpFwd15').addEventListener('click', () => mp.sauter(15));
  $('mpStop').addEventListener('click', () => mp.stop());

  $('mpProgress').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    mp.allerA(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  });

  $('mpBody').addEventListener('click', () => {
    const s = mp.instantane();
    if (s.ouvert) onOpenBook(s.book.id, s.vIndex);
  });
  $('mpBody').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('mpBody').click(); }
  });

  const panneau = (btn, panel, autre) => {
    $(btn).addEventListener('click', () => {
      const p = $(panel);
      p.hidden = !p.hidden;
      if (!p.hidden) $(autre).hidden = true;
    });
  };
  panneau('mpRate', 'mpRatePanel', 'mpSleepPanel');
  panneau('mpSleep', 'mpSleepPanel', 'mpRatePanel');

  $('mpRatePanel').addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (b) mp.definirVitesse(+b.dataset.v);
  });
  $('mpSleepPanel').addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    mp.minuterie(b.dataset.v === '0' ? null : (b.dataset.v === 'piste' ? 'piste' : +b.dataset.v));
    $('mpSleepPanel').hidden = true;
  });
}
