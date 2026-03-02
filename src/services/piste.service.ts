import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('piste-service');

/**
 * API PISTE — Plateforme d'Intermediation des Services pour la Transformation de l'Etat
 * Operated by AIFE (Agence pour l'Informatique Financiere de l'Etat)
 *
 * OAuth2 Client Credentials flow (RFC 6749 section 4.4).
 *
 * APIs available through PISTE:
 * - Legifrance (dila.legifrance) — French law, codes, jurisprudence
 * - JUDILIBRE (minju.judilibre) — Cour de cassation decisions
 * - Chorus Pro (cpro.*) — Electronic invoicing
 * - DUME (tncp.*) — European procurement
 * - CaptchEtat (aife.captchetatv2) — Sovereign CAPTCHA
 *
 * BODACC is a separate free API (bodacc-datadila.opendatasoft.com), no auth required.
 */

interface PisteConfig {
  clientId: string;
  clientSecret: string;
  sandbox: boolean;
}

interface PisteToken {
  accessToken: string;
  expiresAt: number;
}

const PISTE_URLS = {
  sandbox: {
    oauth: 'https://sandbox-oauth.piste.gouv.fr/api/oauth/token',
    api: 'https://sandbox-api.piste.gouv.fr',
  },
  production: {
    oauth: 'https://oauth.piste.gouv.fr/api/oauth/token',
    api: 'https://api.piste.gouv.fr',
  },
};

// BODACC is a separate free API (not on PISTE)
const BODACC_API = 'https://bodacc-datadila.opendatasoft.com/api/explore/v2.1';

export class PisteService {
  private token: PisteToken | null = null;
  private readonly urls: typeof PISTE_URLS.sandbox;

  constructor(private readonly config: PisteConfig) {
    this.urls = config.sandbox ? PISTE_URLS.sandbox : PISTE_URLS.production;
  }

  get isConfigured(): boolean {
    return !!(this.config.clientId && this.config.clientSecret);
  }

  // -------------------------------------------------------------------------
  // OAuth2 Authentication
  // -------------------------------------------------------------------------

  private async authenticate(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) {
      return this.token.accessToken;
    }

    log.info('Requesting new PISTE OAuth2 token');

    const res = await fetch(this.urls.oauth, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        scope: 'openid',
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      log.error({ status: res.status, body: text }, 'PISTE OAuth2 token request failed');
      throw new Error(`PISTE auth failed: ${res.status}`);
    }

    const data = await res.json() as { access_token: string; expires_in: number };
    this.token = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    log.info({ expiresIn: data.expires_in }, 'PISTE OAuth2 token obtained');
    return this.token.accessToken;
  }

  // -------------------------------------------------------------------------
  // Generic HTTP helpers
  // -------------------------------------------------------------------------

  private async pisteGet<T>(path: string, params?: Record<string, string>): Promise<T> {
    const token = await this.authenticate();
    const url = new URL(path, this.urls.api);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v) url.searchParams.set(k, v);
      }
    }

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });

    if (!res.ok) {
      const text = await res.text();
      log.error({ status: res.status, path, body: text }, 'PISTE API request failed');
      throw new Error(`PISTE API error: ${res.status}`);
    }

    return res.json() as Promise<T>;
  }

  private async pistePost<T>(path: string, body: unknown): Promise<T> {
    const token = await this.authenticate();
    const url = new URL(path, this.urls.api);

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      log.error({ status: res.status, path, body: text }, 'PISTE API POST failed');
      throw new Error(`PISTE API error: ${res.status}`);
    }

    return res.json() as Promise<T>;
  }

  // -------------------------------------------------------------------------
  // Legifrance (dila.legifrance) — French law, codes, jurisprudence
  // -------------------------------------------------------------------------

  /**
   * Search Legifrance — codes, laws, decrees, case law.
   */
  async searchLegifrance(params: {
    recherche: string;
    fond?: 'CODE_DATE' | 'LODA_DATE' | 'JURI' | 'CETAT' | 'CASS' | 'ACCO' | 'CIRC';
    pageNumber?: number;
    pageSize?: number;
  }): Promise<unknown> {
    return this.pistePost('/dila/legifrance/lf-engine-app/search', {
      recherche: {
        champs: [{ typeChamp: 'ALL', criteres: [{ typeRecherche: 'EXACTE', valeur: params.recherche }] }],
        filtres: [],
        pageNumber: params.pageNumber ?? 1,
        pageSize: params.pageSize ?? 10,
      },
      fond: params.fond ?? 'LODA_DATE',
    });
  }

  /**
   * Get a specific article from a code (e.g., Code penal).
   */
  async getArticle(articleId: string): Promise<unknown> {
    return this.pistePost('/dila/legifrance/lf-engine-app/consult/getArticle', {
      id: articleId,
    });
  }

  // -------------------------------------------------------------------------
  // JUDILIBRE (minju.judilibre) — Cour de cassation decisions
  // -------------------------------------------------------------------------

  /**
   * Search Cour de cassation decisions (pseudonymized).
   */
  async searchJudilibre(params: {
    query?: string;
    theme?: string;
    chamber?: string;
    dateStart?: string;
    dateEnd?: string;
    page?: number;
    pageSize?: number;
  }): Promise<unknown> {
    const query: Record<string, string> = {};
    if (params.query) query.query = params.query;
    if (params.theme) query.theme = params.theme;
    if (params.chamber) query.chamber = params.chamber;
    if (params.dateStart) query.date_start = params.dateStart;
    if (params.dateEnd) query.date_end = params.dateEnd;
    if (params.page) query.page = String(params.page);
    if (params.pageSize) query.page_size = String(params.pageSize);

    return this.pisteGet('/cassation/judilibre/v1.0/search', query);
  }

  /**
   * Get a specific Cour de cassation decision by ID.
   */
  async getDecision(decisionId: string): Promise<unknown> {
    return this.pisteGet(`/cassation/judilibre/v1.0/decision`, { id: decisionId });
  }

  // -------------------------------------------------------------------------
  // BODACC — Free API (NOT on PISTE, no auth required)
  // -------------------------------------------------------------------------

  /**
   * Search BODACC announcements — insolvencies, liquidations, creations, etc.
   * This is a free public API, no PISTE credentials needed.
   */
  async searchBodacc(params: {
    denomination?: string;
    nomPersonne?: string;
    registreCommerce?: string;
    typeAnnonce?: string;
    dateDebut?: string;
    dateFin?: string;
  }): Promise<unknown> {
    const url = new URL(`${BODACC_API}/catalog/datasets/annonces-commerciales/records`);
    const where: string[] = [];

    if (params.denomination) where.push(`denomination LIKE "${params.denomination}"`);
    if (params.nomPersonne) where.push(`nom_personne LIKE "${params.nomPersonne}"`);
    if (params.registreCommerce) where.push(`registre="${params.registreCommerce}"`);
    if (params.typeAnnonce) where.push(`typeavis="${params.typeAnnonce}"`);
    if (params.dateDebut) where.push(`dateparution>="${params.dateDebut}"`);
    if (params.dateFin) where.push(`dateparution<="${params.dateFin}"`);

    if (where.length > 0) url.searchParams.set('where', where.join(' AND '));
    url.searchParams.set('limit', '20');

    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      throw new Error(`BODACC API error: ${res.status}`);
    }

    return res.json();
  }

  // -------------------------------------------------------------------------
  // Health check
  // -------------------------------------------------------------------------

  async healthCheck(): Promise<{ ok: boolean; environment: string; error?: string }> {
    try {
      await this.authenticate();
      return { ok: true, environment: this.config.sandbox ? 'sandbox' : 'production' };
    } catch (err: any) {
      return { ok: false, environment: this.config.sandbox ? 'sandbox' : 'production', error: err.message };
    }
  }
}

// Singleton
let _instance: PisteService | null = null;

export function getPisteService(): PisteService {
  if (!_instance) {
    _instance = new PisteService({
      clientId: process.env.PISTE_CLIENT_ID || '',
      clientSecret: process.env.PISTE_CLIENT_SECRET || '',
      sandbox: process.env.PISTE_SANDBOX !== 'false',
    });
  }
  return _instance;
}
