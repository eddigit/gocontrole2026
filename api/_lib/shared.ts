import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Singleton Prisma client for serverless (reused across warm invocations)
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

const SALT_ROUNDS = 12;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): Record<string, unknown> {
  return jwt.verify(token, JWT_SECRET) as Record<string, unknown>;
}

export interface AuthPayload {
  userId: string;
  email: string;
  role: string;
}

/**
 * Extract and verify JWT from Authorization header.
 * Returns null if unauthorized.
 */
export function authenticate(req: VercelRequest): AuthPayload | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const payload = verifyToken(authHeader.slice(7)) as AuthPayload;
    if (!payload.userId) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Helper to set CORS headers for Vercel serverless functions.
 */
export function cors(req: VercelRequest, res: VercelResponse): boolean {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

/**
 * Ensure admin user exists (called on first API request).
 */
export async function ensureAdmin(): Promise<void> {
  const email = process.env.ADMIN_EMAIL || 'admin@gocontrole.local';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    const hashed = await hashPassword(password);
    await prisma.user.create({
      data: { email, password: hashed, name: 'Admin', role: 'ADMIN' },
    });
  }
}

/**
 * Convert phone number to WhatsApp JID.
 */
export function phoneToJid(phone: string): string {
  const cleaned = phone.replace(/[\s\-\+\(\)]/g, '');
  return `${cleaned}@s.whatsapp.net`;
}

export function formatPhone(phone: string): string {
  return phone.replace(/[\s\-\(\)]/g, '').replace(/^\+/, '');
}
