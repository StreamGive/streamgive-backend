import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

const DEFAULT_DATABASE_URL = 'postgresql://streamgive:streamgive@localhost:5432/streamgive';
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
});

export const prisma = new PrismaClient({ adapter });
