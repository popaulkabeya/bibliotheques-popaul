/**
 * stockage.js — Téléchargement des livres pour le hors-ligne et état du stockage.
 */
import * as store from './store.js';
import * as lib from './library.js';
import { demander } from './dialogue.js';

const $ = (id) => document.getElementById(id);
let signaler = () => {};
let rafraichir = () => {};
export function initStockage({ onToast, onRefresh }) { signaler = onToast; rafraichir = onRefresh; }

/**
 * Sans stockage persistant, le navigateur peut évincer les livres téléchargés sous
 * pression disque — l'utilisateur croirait les avoir hors ligne alors qu'ils ont disparu.
 * On le dit, et on indique le geste qui règle le problème : installer l'application.
 */
async function majPersistance(nbLivres) {
  const el = $('persistWarn');
  if (!el) return;
  if (!nbLivres || !navigator.storage?.persisted) { el.hidden = true; return; }
  const sur = await navigator.storage.persisted().catch(() => false);
  el.hidden = sur;
  if (!sur) {
    el.textContent = "⚠ Stockage non garanti : le navigateur peut supprimer ces livres " +
      "s'il manque de place. Installez l'application (menu du navigateur → Installer, " +
      "ou « Sur l'écran d'accueil » sur iPhone) pour les conserver à coup sûr.";
  }
}

/* ═══════════════ Stockage hors-ligne ═══════════════ */

export async function updateStorage() {
  const u = await store.usage();
  const n = lib.state.cached.size;
  majPersistance(n);
  const bytes = lib.state.catalog.books.filter((b) => lib.state.cached.has(b.id))
    .reduce((s, b) => s + (b.bytes || 0), 0);
  $('gaugeFill').style.width = Math.min(100, (u?.ratio || 0) * 100).toFixed(1) + '%';
  $('storageLine').innerHTML = n
    ? `<b>${n}</b> livre${n > 1 ? 's' : ''} sur l'appareil · ${store.formatBytes(bytes)}` +
      (u ? `<br>${store.formatBytes(u.used)} utilisés sur ${store.formatBytes(u.quota)}` : '')
    : `Aucun livre téléchargé.<br>Bibliothèque complète : ${store.formatBytes(lib.state.catalog.totalBytes || 0)}`;
}

export async function cacheEverything() {
  const btn = $('cacheAllBtn');
  const books = lib.state.catalog.books.filter((b) => !lib.state.cached.has(b.id));
  if (!books.length) return signaler('Toute la bibliothèque est déjà sur cet appareil.');
  const poids = store.formatBytes(books.reduce((s, b) => s + (b.bytes || 0), 0));
  const ok = await demander({
    titre: `Télécharger ${books.length} ouvrage${books.length > 1 ? 's' : ''} ?`,
    message: `Environ ${poids} seront enregistrés sur cet appareil. Vous pourrez alors lire sans réseau, même serveur éteint.`,
    valider: 'Télécharger' });
  if (!ok) return;

  await store.persist();
  btn.disabled = true;
  let i = 0;
  for (const b of books) {
    btn.textContent = `${++i}/${books.length}…`;
    try { await store.cacheBook(b); lib.state.cached.add(b.id); }
    catch (e) { signaler('Interrompu : ' + e.message); break; }
  }
  btn.disabled = false;
  btn.textContent = 'Tout télécharger';
  await lib.refreshState();
  rafraichir();
  updateStorage();
  signaler('Bibliothèque disponible hors connexion.');
}

