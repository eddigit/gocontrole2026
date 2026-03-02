import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { getPisteService } from '../../services/piste.service.js';

/**
 * API PISTE routes — proxy to French government APIs.
 * All routes require authentication.
 *
 * Available APIs:
 * - /piste/legifrance — French law, codes, jurisprudence (via PISTE)
 * - /piste/judilibre — Cour de cassation decisions (via PISTE)
 * - /piste/bodacc — BODACC announcements (free API, no PISTE creds needed)
 * - /piste/status — Check PISTE connectivity
 */
export async function pisteRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /api/piste/status — Check PISTE connectivity
  fastify.get('/status', { preHandler: [authenticate] }, async () => {
    const piste = getPisteService();
    if (!piste.isConfigured) {
      return {
        configured: false,
        bodaccAvailable: true,
        message: 'PISTE credentials not configured. BODACC (free) is still available.',
      };
    }
    const health = await piste.healthCheck();
    return { configured: true, bodaccAvailable: true, ...health };
  });

  // -------------------------------------------------------------------------
  // Legifrance
  // -------------------------------------------------------------------------

  // POST /api/piste/legifrance/search — Search French law
  fastify.post<{
    Body: {
      recherche: string;
      fond?: string;
      page?: number;
      pageSize?: number;
    };
  }>('/legifrance/search', { preHandler: [authenticate] }, async (request, reply) => {
    const piste = getPisteService();
    if (!piste.isConfigured) return reply.status(503).send({ error: 'PISTE not configured' });

    const { recherche, fond, page, pageSize } = request.body;
    return piste.searchLegifrance({
      recherche,
      fond: fond as any,
      pageNumber: page,
      pageSize,
    });
  });

  // POST /api/piste/legifrance/article — Get specific article
  fastify.post<{
    Body: { articleId: string };
  }>('/legifrance/article', { preHandler: [authenticate] }, async (request, reply) => {
    const piste = getPisteService();
    if (!piste.isConfigured) return reply.status(503).send({ error: 'PISTE not configured' });

    return piste.getArticle(request.body.articleId);
  });

  // -------------------------------------------------------------------------
  // JUDILIBRE — Cour de cassation
  // -------------------------------------------------------------------------

  // GET /api/piste/judilibre/search — Search court decisions
  fastify.get<{
    Querystring: {
      query?: string;
      theme?: string;
      chamber?: string;
      dateStart?: string;
      dateEnd?: string;
      page?: string;
    };
  }>('/judilibre/search', { preHandler: [authenticate] }, async (request, reply) => {
    const piste = getPisteService();
    if (!piste.isConfigured) return reply.status(503).send({ error: 'PISTE not configured' });

    const { query, theme, chamber, dateStart, dateEnd, page } = request.query;
    return piste.searchJudilibre({
      query,
      theme,
      chamber,
      dateStart,
      dateEnd,
      page: page ? parseInt(page) : undefined,
    });
  });

  // GET /api/piste/judilibre/decision — Get specific decision
  fastify.get<{
    Querystring: { id: string };
  }>('/judilibre/decision', { preHandler: [authenticate] }, async (request, reply) => {
    const piste = getPisteService();
    if (!piste.isConfigured) return reply.status(503).send({ error: 'PISTE not configured' });

    return piste.getDecision(request.query.id);
  });

  // -------------------------------------------------------------------------
  // BODACC — Free API (no PISTE creds needed)
  // -------------------------------------------------------------------------

  // GET /api/piste/bodacc — Search BODACC announcements
  fastify.get<{
    Querystring: {
      denomination?: string;
      nomPersonne?: string;
      registreCommerce?: string;
      type?: string;
      dateDebut?: string;
      dateFin?: string;
    };
  }>('/bodacc', { preHandler: [authenticate] }, async (request) => {
    const piste = getPisteService();
    const { denomination, nomPersonne, registreCommerce, type, dateDebut, dateFin } = request.query;
    return piste.searchBodacc({
      denomination,
      nomPersonne,
      registreCommerce,
      typeAnnonce: type,
      dateDebut,
      dateFin,
    });
  });
}
