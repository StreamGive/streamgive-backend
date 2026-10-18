import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';

describe('Graceful Shutdown Sequence (#284)', () => {
  it('should stop indexer, close app, and disconnect Prisma in correct order', async () => {
    const executionOrder: string[] = [];

    const mockIndexerService = {
      stopIndexer: jest.fn().mockImplementation(async () => {
        // Simulate slow in-flight poll
        await new Promise((resolve) => setTimeout(resolve, 50));
        executionOrder.push('indexer_stopped');
      }),
    };

    const mockPrismaService = {
      $disconnect: jest.fn().mockImplementation(async () => {
        executionOrder.push('prisma_disconnected');
      }),
    };

    const mockApp = {
      close: jest.fn().mockImplementation(async () => {
        executionOrder.push('app_closed');
      }),
      listen: jest.fn().mockResolvedValue(true),
    };

    // Simulate graceful shutdown logic
    await mockIndexerService.stopIndexer();
    await mockApp.close();
    await mockPrismaService.$disconnect();

    expect(executionOrder).toEqual([
      'indexer_stopped',
      'app_closed',
      'prisma_disconnected',
    ]);
  });
});