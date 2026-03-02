import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import { Server as SocketServer } from 'socket.io';
import http from 'http';
import path from 'path';
import { env } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import { authRoutes } from './routes/auth.routes.js';
import { sessionRoutes } from './routes/sessions.routes.js';
import { targetRoutes } from './routes/targets.routes.js';
import { dashboardRoutes } from './routes/dashboard.routes.js';
import { alertRoutes } from './routes/alerts.routes.js';
import { healthRoutes } from './routes/health.routes.js';
import { messageRoutes } from './routes/messages.routes.js';
import { callRoutes } from './routes/calls.routes.js';
import { groupRoutes } from './routes/groups.routes.js';
import type { PrismaClient } from '@prisma/client';
import type { SessionManager } from '../whatsapp/session-manager.js';
import type { SignalAggregator } from '../detection/signal-aggregator.js';

const log = createChildLogger('api-server');

export interface AppContext {
  prisma: PrismaClient;
  sessionManager: SessionManager;
  signalAggregator: SignalAggregator;
}

declare module 'fastify' {
  interface FastifyInstance {
    appContext: AppContext;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { userId: string; email: string; role: string };
    user: { userId: string; email: string; role: string };
  }
}

export async function createServer(context: AppContext) {
  const fastify = Fastify({
    loggerInstance: log,
  });

  // Decorate with app context
  fastify.decorate('appContext', context);

  // CORS
  await fastify.register(cors, {
    origin: true,
    credentials: true,
  });

  // JWT
  await fastify.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_EXPIRES_IN },
  });

  // Routes
  await fastify.register(authRoutes, { prefix: '/api/auth' });
  await fastify.register(sessionRoutes, { prefix: '/api/sessions' });
  await fastify.register(targetRoutes, { prefix: '/api/targets' });
  await fastify.register(dashboardRoutes, { prefix: '/api/dashboard' });
  await fastify.register(alertRoutes, { prefix: '/api/alerts' });
  await fastify.register(healthRoutes, { prefix: '/api/health' });
  await fastify.register(messageRoutes, { prefix: '/api/messages' });
  await fastify.register(callRoutes, { prefix: '/api/calls' });
  await fastify.register(groupRoutes, { prefix: '/api/groups' });

  // Serve React frontend static files
  const clientDir = path.join(__dirname, '..', 'client');
  try {
    await fastify.register(fastifyStatic, {
      root: clientDir,
      prefix: '/',
      wildcard: false,
    });
    // SPA fallback: return index.html for all non-API routes
    fastify.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        reply.status(404).send({ error: 'Not found' });
      } else {
        reply.sendFile('index.html');
      }
    });
    log.info({ clientDir }, 'Serving frontend static files');
  } catch {
    log.warn('Frontend static files not found, API-only mode');
    fastify.setNotFoundHandler((_, reply) => {
      reply.status(404).send({ error: 'Not found' });
    });
  }

  // Error handler
  fastify.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    log.error({ err: error, url: request.url }, 'Request error');
    reply.status(error.statusCode ?? 500).send({
      error: error.message || 'Internal Server Error',
    });
  });

  return fastify;
}

export function createSocketServer(httpServer: http.Server, context: AppContext): SocketServer {
  const io = new SocketServer(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  io.on('connection', (socket) => {
    log.info({ socketId: socket.id }, 'Client connected');

    socket.on('target:subscribe', (data: { jids: string[] }) => {
      for (const jid of data.jids) {
        socket.join(`target:${jid}`);
      }
    });

    socket.on('target:unsubscribe', (data: { jids: string[] }) => {
      for (const jid of data.jids) {
        socket.leave(`target:${jid}`);
      }
    });

    socket.on('disconnect', () => {
      log.debug({ socketId: socket.id }, 'Client disconnected');
    });
  });

  // Listen for confidence score updates and broadcast
  context.signalAggregator.on('score', (score) => {
    io.to(`target:${score.jid}`).emit('presence:update', score);
    io.emit('dashboard:update', score); // Also broadcast to dashboard
  });

  // Listen for session connection events
  context.sessionManager.on('session:connection', (event) => {
    io.emit('session:status', event);
  });

  return io;
}
