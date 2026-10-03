import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

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
