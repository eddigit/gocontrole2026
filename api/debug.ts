import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const results: Record<string, unknown> = {};

  // Test 1: Prisma import
  try {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    results.prismaImport = 'ok';

    // Test 2: Database connection
    try {
      await prisma.$queryRaw`SELECT 1 as test`;
      results.dbConnection = 'ok';
    } catch (e: any) {
      results.dbConnection = { error: e.message };
    }

    // Test 3: User table query
    try {
      const count = await prisma.user.count();
      results.userTable = { ok: true, count };
    } catch (e: any) {
      results.userTable = { error: e.message, code: e.code };
    }

    await prisma.$disconnect();
  } catch (e: any) {
    results.prismaImport = { error: e.message };
  }

  // Test 4: bcrypt
  try {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('test', 10);
    const valid = await bcrypt.compare('test', hash);
    results.bcrypt = { ok: true, valid };
  } catch (e: any) {
    results.bcrypt = { error: e.message };
  }

  // Test 5: jsonwebtoken
  try {
    const jwt = await import('jsonwebtoken');
    const token = jwt.default.sign({ test: true }, 'secret', { expiresIn: '1h' } as any);
    results.jwt = { ok: true, tokenLength: token.length };
  } catch (e: any) {
    results.jwt = { error: e.message };
  }

  // Test 6: env vars
  results.envVars = {
    POSTGRES_PRISMA_URL: process.env.POSTGRES_PRISMA_URL ? 'set' : 'missing',
    POSTGRES_URL_NON_POOLING: process.env.POSTGRES_URL_NON_POOLING ? 'set' : 'missing',
    DATABASE_URL: process.env.DATABASE_URL ? 'set' : 'missing',
    JWT_SECRET: process.env.JWT_SECRET ? 'set' : 'missing',
    ADMIN_EMAIL: process.env.ADMIN_EMAIL ? 'set' : 'missing',
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ? 'set' : 'missing',
    NODE_ENV: process.env.NODE_ENV,
  };

  return res.status(200).json(results);
}
