/**
 * tts.js — Lecture vocale par synthèse vocale du système (Web Speech API).
 * Fonctionne hors-ligne : les voix sont celles installées sur l'appareil.
 */

const synth = window.speechSynthesis;

export const supported = () => 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

/* ─────────── Voix disponibles ─────────── */

let voicesCache = [];

/** La liste des voix arrive de façon asynchrone sur la plupart des navigateurs. */
export function loadVoices(timeout = 2500) {
  return new Promise((resolve) => {
    const grab = () => synth.getVoices() || [];
    let v = grab();
    if (v.length) { voicesCache = v; return resolve(v); }
    const done = () => { voicesCache = grab(); resolve(voicesCache); };
    synth.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, timeout);
  });
}

/** Variante régionale préférée pour chaque langue de la bibliothèque. */
const PREFERRED = { fr: 'fr-fr', en: 'en-gb', gez: 'fr-fr' };

/**
 * Voix « personnages » livrées par macOS et iOS dans toutes les langues.
 * Elles sont expressives, pas intelligibles : sur un texte suivi elles rendent
 * l'écoute pénible. La première liste est la génération récente (Eddy, Grandma,
 * Rocko…), la seconde les anciennes voix fantaisistes d'Apple. Sans elles, ces
 * voix obtiennent le même score qu'une voix de lecture et l'emportent au tri
 * alphabétique — « Eddy » avant « Thomas ».
 */
const FANTAISIE = new RegExp(
  '\\b(eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|superstar|bahh'
  + '|albert|fred|junior|ralph|kathy|bruce|bells|bubbles|boing|cellos|jester'
  + '|organ|trinoids|whisper|wobble|zarvox|bad news|good news|novelty|eloquence)\\b', 'i');

/** Variantes allégées : intelligibles, mais nettement plus sourdes que l'originale. */
const ALLEGEE = /\bcompact\b/i;

/** Voix de lecture éprouvées, par langue : celles qui tiennent un texte long. */
const RECOMMANDEES = {
  fr: /\b(thomas|jacques|am[ée]lie|aur[ée]lie|marie|nicolas|chantal|audrey)\b/i,
  en: /\b(daniel|serena|kate|oliver|samantha|alex|karen|moira|tessa)\b/i,
};

/** Voix triées : langue du livre, variante régionale, qualité, disponibilité hors-ligne. */
export function rankVoices(lang = 'fr') {
  const base = (lang || 'fr').slice(0, 2).toLowerCase();
  const exact = PREFERRED[base] || base;
  const score = (v) => {
    const l = v.lang.toLowerCase().replace('_', '-');
    let s = 0;
    if (l.startsWith(base)) s += 200;                   // bonne langue
    if (l === exact) s += 60;                           // bonne variante régionale
    if (/premium|enhanced|neural|natural|siri/i.test(v.name)) s += 90;   // qualité audible
    if (RECOMMANDEES[base]?.test(v.name)) s += 50;      // voix de lecture connue
    if (v.localService) s += 25;                        // fonctionne hors connexion
    if (v.default) s += 5;
    if (ALLEGEE.test(v.name)) s -= 30;
    if (FANTAISIE.test(v.name)) s -= 400;               // jamais choisie d'office
    return s;
  };
  return [...voicesCache].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
}

/* ─────────── Découpage du texte ─────────── */

const ABBR = /\b(M|Mme|Mlle|Dr|St|Ste|cf|env|etc|av|ap|J\.-C|c\.-à-d|vol|chap|éd|trad|p|pp|fig|n[°o])\.$/i;

/**
 * Découpe un texte en phrases lisibles d'un seul souffle.
 * Les blocs trop longs sont recoupés aux virgules pour éviter les coupures du moteur.
 */
/**
 * Nettoie un texte issu d'un OCR ou d'un PDF avant de le confier à la synthèse vocale :
 * ligatures typographiques, césures de fin de ligne, tirets conditionnels, espaces parasites.
 */
export function normalizeText(raw, { ocr = false } = {}) {
  let s = String(raw || '')
    .normalize('NFKC')                       // ﬁ → fi, ﬂ → fl, ligatures et exposants
    .replace(/\u00AD/g, '')                  // tiret conditionnel
    .replace(/§§[A-Z0-9]+§§/gi, ' ')         // marqueur de fabrication resté dans le PDF
    .replace(/([\p{Ll}])-\s*\n\s*([\p{Ll}])/gu, '$1$2')   // césure de fin de ligne
    .replace(/\s*\n\s*/g, ' ');
  // « in fl uence » → « influence » : l'OCR isole la ligature entre deux blancs. Réservé aux
  // PDF : sur un texte saisi, la règle soudait « le fils » en « lefils », et ce texte normalisé
  // est aussi celui qu'affiche le lecteur (sentences.js).
  if (ocr) s = s.replace(/([\p{Ll}])\s+(ffi|ffl|fi|fl|ff)\s+([\p{Ll}])/gu, '$1$2$3');
  return s
    .replace(/\s+([,.])/g, '$1')             // l'espace avant : ; ! ? » est correct en français
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function splitSentences(text, max = 240, opts = {}) {
  const clean = normalizeText(text, opts);
  if (!clean) return [];

  const out = [];
  let buf = '';
  for (const chunk of clean.split(/(?<=[.!?…:;])\s+/)) {
    if (ABBR.test(buf + chunk)) { buf += chunk + ' '; continue; }   // ne pas couper sur « M. »
    const s = (buf + chunk).trim();
    buf = '';
    if (s.length <= max) { if (s) out.push(s); continue; }
    // Phrase trop longue : on recoupe aux virgules
    let part = '';
    for (const piece of s.split(/(?<=,)\s+/)) {
      if ((part + piece).length > max && part) { out.push(part.trim()); part = ''; }
      part += piece + ' ';
    }
    if (part.trim()) out.push(part.trim());
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter((s) => /[\p{L}\p{N}]/u.test(s));                 // écarte la ponctuation seule
}

/* ─────────── Le lecteur ─────────── */

export class Speaker {
  constructor() {
    this.queue = [];
    this.index = 0;
    this.playing = false;
    this.paused = false;
    this.voice = null;
    this.rate = 1;
    this.pitch = 1;
    this.lang = 'fr-FR';
    this.onSentence = null;   // (index, texte) → surlignage
    this.onEnd = null;        // fin de la file → page suivante
    this.onState = null;      // (playing, paused) → boutons
    this._keepAlive = null;
    this._stopping = false;
  }

  /** Charge une nouvelle file de phrases. */
  load(sentences, startAt = 0) {
    this.stop();
    this.queue = sentences;
    this.index = Math.max(0, Math.min(startAt, sentences.length - 1));
    return this.queue.length;
  }

  get total() { return this.queue.length; }
  get progress() { return this.total ? (this.index + 1) / this.total : 0; }

  play() {
    if (!this.queue.length) return;
    if (this.paused) { synth.resume(); this.paused = false; this.playing = true; this._tick(); this._emit(); return; }
    if (this.playing) return;
    this.playing = true;
    this._emit();
    this._speak();
  }

  pause() {
    if (!this.playing) return;
    synth.pause();
    this.paused = true;
    this.playing = false;
    this._stopTick();
    this._emit();
  }

  toggle() { (this.playing && !this.paused) ? this.pause() : this.play(); }

  stop() {
    this._stopping = true;
    this.playing = false;
    this.paused = false;
    this._stopTick();
    try { synth.cancel(); } catch {}
    setTimeout(() => { this._stopping = false; }, 60);
    this._emit();
  }

  /** Saute de n phrases (négatif pour revenir en arrière). */
  skip(n) {
    const next = Math.max(0, Math.min(this.index + n, this.queue.length - 1));
    const wasPlaying = this.playing;
    this.index = next;
    try { synth.cancel(); } catch {}
    // En pause, la phrase suspendue vient d'être annulée : « reprendre » ne relancerait que
    // du vide, bouton sur lecture et voix muette. On sort de la pause pour relire la nouvelle.
    if (this.paused) { this.paused = false; try { synth.resume(); } catch {} }
    this.onSentence?.(this.index, this.queue[this.index]);
    if (wasPlaying) { this.playing = true; this.paused = false; setTimeout(() => this._speak(), 60); }
    this._emit();
  }

  goTo(i) { this.skip(i - this.index); }

  _speak() {
    if (!this.playing || this.index >= this.queue.length) return;
    const text = this.queue[this.index];
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.lang = this.voice?.lang || this.lang;
    u.rate = this.rate;
    u.pitch = this.pitch;

    u.onstart = () => this.onSentence?.(this.index, text);
    u.onend = () => {
      if (!this.playing || this._stopping) return;
      this.index++;
      if (this.index < this.queue.length) this._speak();
      else { this.playing = false; this._stopTick(); this._emit(); this.onEnd?.(); }
    };
    u.onerror = (e) => {
      if (e.error === 'interrupted' || e.error === 'canceled' || this._stopping) return;
      this.index++;
      if (this.index < this.queue.length) this._speak();
      else { this.playing = false; this._emit(); this.onEnd?.(); }
    };

    synth.speak(u);
    this._tick();
  }

  /** Chrome coupe la synthèse au bout de ~15 s : on la relance discrètement. */
  _tick() {
    this._stopTick();
    this._keepAlive = setInterval(() => {
      if (!this.playing || this.paused) return;
      if (synth.speaking) { synth.pause(); synth.resume(); }
    }, 9000);
  }
  _stopTick() { if (this._keepAlive) { clearInterval(this._keepAlive); this._keepAlive = null; } }
  _emit() { this.onState?.(this.playing, this.paused); }
}

/** Une seule voix parle à la fois dans toute l'application. */
export const speaker = new Speaker();

// La synthèse survit mal au rechargement de page : on coupe proprement.
window.addEventListener('beforeunload', () => { try { synth.cancel(); } catch {} });
