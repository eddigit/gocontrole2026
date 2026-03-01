import type { FastifyInstance } from 'fastify';
import { hashPassword, verifyPassword } from '../../utils/crypto.js';
import { authenticate } from '../middleware/auth.js';

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  const { prisma } = fastify.appContext;

  // POST /api/auth/login
  fastify.post<{
    Body: { email: string; password: string };
  }>('/login', async (request, reply) => {
    const { email, password } = request.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const valid = await verifyPassword(password, user.password);
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const token = fastify.jwt.sign({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  });

  // POST /api/auth/register (admin only)
  fastify.post<{
    Body: { email: string; password: string; name: string; role?: string };
  }>('/register', { preHandler: [authenticate] }, async (request, reply) => {
    if (request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Admin access required' });
    }

    const { email, password, name, role } = request.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.status(409).send({ error: 'Email already registered' });
    }

    const hashedPassword = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role: (role as any) || 'OPERATOR',
      },
      select: { id: true, email: true, name: true, role: true },
    });

    return { user };
  });

  // GET /api/auth/me
  fastify.get('/me', { preHandler: [authenticate] }, async (request) => {
    const user = await prisma.user.findUnique({
      where: { id: request.user.userId },
      select: { id: true, email: true, name: true, role: true },
    });
    return { user };
  });
}
