import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { Response } from 'express';
// Import your database health indicator and indexer service / config

@Controller('health')
export class HealthController {
  constructor(
    private readonly databaseHealthIndicator: any, // replace with actual DB health service
    private readonly indexerService: any // replace with actual indexer service/config
  ) {}

  @Get('ready')
  async checkReadiness(@Res() res: Response) {
    const configuredContracts = this.indexerService?.getConfiguredContractIds?.() || [];
    const isIndexerEnabled = configuredContracts.length > 0;

    let dbStatus = { status: 'up' };
    try {
      dbStatus = await this.databaseHealthIndicator.pingCheck('database');
    } catch (error) {
      dbStatus = { status: 'down', error: error.message };
    }

    // If indexer has no contracts configured, treat as disabled (healthy for traffic routing)
    const indexerState = isIndexerEnabled ? (this.indexerService.isRunning() ? 'running' : 'stopped') : 'disabled';
    
    // Readiness should succeed if DB is up, even if indexer is disabled due to missing contract IDs
    const isReady = dbStatus.status === 'up' && (!isIndexerEnabled || this.indexerService.isRunning());

    const payload = {
      status: isReady ? 'ok' : 'error',
      database: dbStatus,
      indexer: indexerState,
    };

    return res.status(isReady ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json(payload);
  }
}