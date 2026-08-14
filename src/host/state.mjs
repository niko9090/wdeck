/**
 * Stato runtime dell'host: profilo/pagina attivi, client collegati, ultima azione.
 * Emette eventi che l'hub WebSocket rilancia ai client.
 */

import { EventEmitter } from 'node:events';

export class HostState extends EventEmitter {
  /**
   * @param {object} deck deck normalizzato
   */
  constructor(deck) {
    super();
    this.setMaxListeners(64);
    /** @type {string} */
    this.activeProfileId = deck.defaultProfile;
    /** @type {string} */
    this.activePageId = this.#profile(deck, deck.defaultProfile).defaultPage;
    /** @type {boolean} */
    this.dryRun = deck.settings.security.dryRun === true;
    /** @type {object} */
    this.deck = deck;
    /** @type {object|null} */
    this.lastAction = null;
    /** @type {number} */
    this.startedAt = Date.now();
    /** @type {Set<object>} */
    this.clients = new Set();
    /** @type {number} */
    this.pressCount = 0;
  }

  #profile(deck, id) {
    return deck.profiles.find((p) => p.id === id) ?? deck.profiles[0];
  }

  /** Profilo attivo (oggetto normalizzato). */
  get profile() {
    return this.#profile(this.deck, this.activeProfileId);
  }

  /** Pagina attiva (oggetto normalizzato). */
  get page() {
    const profile = this.profile;
    return profile.pages.find((p) => p.id === this.activePageId) ?? profile.pages[0];
  }

  /**
   * Cambia profilo e/o pagina attivi.
   * @param {string} [profileId]
   * @param {string} [pageId]
   * @returns {{profileId: string, pageId: string}}
   */
  navigate(profileId, pageId) {
    const targetProfile = profileId
      ? this.deck.profiles.find((p) => p.id === profileId)
      : this.profile;
    if (!targetProfile) throw new Error(`profilo sconosciuto: "${profileId}"`);

    let targetPage = pageId
      ? targetProfile.pages.find((p) => p.id === pageId)
      : targetProfile.pages.find((p) => p.id === this.activePageId) ?? null;
    if (pageId && !targetPage) throw new Error(`pagina sconosciuta: "${pageId}" nel profilo "${targetProfile.id}"`);
    if (!targetPage) targetPage = targetProfile.pages.find((p) => p.id === targetProfile.defaultPage) ?? targetProfile.pages[0];

    const changed = this.activeProfileId !== targetProfile.id || this.activePageId !== targetPage.id;
    this.activeProfileId = targetProfile.id;
    this.activePageId = targetPage.id;
    if (changed) this.emit('navigate', this.snapshot());
    return { profileId: this.activeProfileId, pageId: this.activePageId };
  }

  /** Attiva/disattiva la modalita' dry-run a runtime. */
  setDryRun(value) {
    const next = value === true;
    if (next !== this.dryRun) {
      this.dryRun = next;
      this.emit('state', this.snapshot());
    }
    return this.dryRun;
  }

  /**
   * Sostituisce il deck (hot reload) mantenendo, se possibile, profilo e pagina attivi.
   * @param {object} deck
   */
  replaceDeck(deck) {
    this.deck = deck;
    const profile = deck.profiles.find((p) => p.id === this.activeProfileId) ?? this.#profile(deck, deck.defaultProfile);
    this.activeProfileId = profile.id;
    const page = profile.pages.find((p) => p.id === this.activePageId) ?? profile.pages.find((p) => p.id === profile.defaultPage) ?? profile.pages[0];
    this.activePageId = page.id;
    this.dryRun = deck.settings.security.dryRun === true || this.dryRun;
    this.emit('deck', deck);
    this.emit('state', this.snapshot());
  }

  /** Registra il risultato di una pressione. */
  recordPress(entry) {
    this.pressCount += 1;
    this.lastAction = {
      buttonId: entry.buttonId,
      type: entry.type,
      ok: entry.ok,
      dryRun: entry.dryRun,
      detail: entry.detail ?? null,
      error: entry.error ?? null,
      at: Date.now()
    };
    this.emit('press', this.lastAction);
    // L'evento 'action' porta la voce completa - chi ha premuto, da dove, con
    // quale esito - e serve al registro di audit. Ai client va invece la forma
    // ridotta: l'identificativo del dispositivo di un altro non li riguarda.
    this.emit('action', entry);
    this.emit('state', this.snapshot());
    return this.lastAction;
  }

  addClient(client) {
    this.clients.add(client);
    this.emit('clients', this.clients.size);
    this.emit('state', this.snapshot());
  }

  removeClient(client) {
    if (this.clients.delete(client)) {
      this.emit('clients', this.clients.size);
      this.emit('state', this.snapshot());
    }
  }

  /** Istantanea serializzabile dello stato, inviata ai client. */
  snapshot() {
    return {
      activeProfile: this.activeProfileId,
      activePage: this.activePageId,
      dryRun: this.dryRun,
      clients: this.clients.size,
      pressCount: this.pressCount,
      lastAction: this.lastAction,
      uptimeMs: Date.now() - this.startedAt,
      deckName: this.deck.name,
      platform: process.platform
    };
  }
}

/** @param {object} deck */
export function createState(deck) {
  return new HostState(deck);
}
