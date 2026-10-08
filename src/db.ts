import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

const DEFAULT_DATABASE_URL = 'postgresql://streamgive:streamgive@localhost:5432/streamgive';
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
});

export const prisma = new PrismaClient({ adapter });

export interface NgoVerificationRecord {
  id: string;
  walletAddress: string;
  verified: boolean;
}

export async function getNgoVerificationRecords(): Promise<NgoVerificationRecord[]> {
  return prisma.nGO.findMany({
    select: { id: true, walletAddress: true, verified: true },
  });
}

export async function setNgoVerified(id: string, verified: boolean): Promise<void> {
  await prisma.nGO.update({
    where: { id },
    data: { verified },
  });
}
