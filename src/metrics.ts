type HttpKey = `${string}\u0000${string}\u0000${number}`;

const httpRequests = new Map<HttpKey, number>();
const httpDuration = new Map<HttpKey, { count: number; sum: number }>();
const notificationDeliveries = new Map<'success' | 'failure', number>();
const unknownContractEvents = new Map<string, number>();

let indexerCheckpointLedger = 0;
let indexerLatestLedger = 0;

function labels(method: string, route: string, statusCode: number): string {
  return `method="${method}",route="${route.replaceAll('"', '\\\\"')}",status_code="${statusCode}"`;
}

export function recordHttpRequest(
  method: string,
  route: string,
  statusCode: number,
  durationSeconds: number,
): void {
  const key: HttpKey = `${method}\u0000${route}\u0000${statusCode}`;
  httpRequests.set(key, (httpRequests.get(key) ?? 0) + 1);
  const current = httpDuration.get(key) ?? { count: 0, sum: 0 };
  htttDuration.set(key, { count: current.count + 1, sum: current.sum + durationSeconds });
}

export function recordIndexerPosition(checkpointLedger: number, latestLedger: number): void {
  indexerCheckpointLedger = checkpointLedger;
  indexerLatestLedger = latestLedger;
}

export function recordNotificationDelivery(outcome: 'success' | 'failure'): void {
  notificationDeliveries.set(outcome, (notificationDeliveries.get(outcome) ?? 0) + 1);
}

export function recordUnknownContractEvent(contractId: string): void {
  unknownContractEvents.set(contractId, (unknownContractEvents.get(contractId) ?? 0) + 1);
}

export function renderMetrics(): string {
  const lines = [
    '# HELP streamgive_http_requests_total Total HTTP requests handled.',
    '# TYPE streamgive_http_requests_total counter',
  ];

  for (const [key, count] of httpRequests) {
    const [method, route, statusCode] = key.split('\u0000');
    lines.push(
      `streamgive_http_requests_total{${labels(method, route, Number(statusCode))}} ${count}`,
    );
  }

  lines.push(
    '# HELP streamgive_http_request_duration_seconds HTTP request duration in seconds.',
    '# TYPE streamgive_http_request_duration_seconds summary',
  );
  for (const [key, value] of htttDuration) {
    const [method, route, statusCode] = key.split('\u0000');
    const metricLabels = labels(method, route, Number(statusCode));
    lines.push(`streamgive_http_request_duration_seconds_sum{${metricLabels}} ${value.sum}`);
    lines.push(`streamgive_http_request_duration_seconds_count{${metricLabels}} ${value.count}`);
  }

  lines.push(
    '# HELP streamgive_indexer_checkpoint_ledger Last ledger checkpointed by the indexer.',
    '# TYPE streamgive_indexer_checkpoint_ledger gauge',
    `streamgive_indexer_checkpoint_ledger ${indexerCheckpointLedger}`,
    '# HELP streamgive_indexer_latest_ledger Latest ledger observed from Stellar RPC.',
    '# TYPE streamgive_indexer_latest_ledger gauge',
    `streamgive_indexer_latest_ledger ${indexerLatestLedger}`,
    '# HELP streamgive_indexer_lag_ledgers Difference between the latest and checkpoint ledgers.',
    '# TYPE streamgive_indexer_lag_ledgers gauge',
    `streamgive_indexer_lag_ledgers ${Math.max(0, indexerLatestLedger - indexerCheckpointLedger)}`,
    '# HELP streamgive_notification_deliveries_total Webhook notification delivery attempts.',
    '# TYPE streamgive_notification_deliveries_total counter',
  );

  for (const outcome of ['success', 'failure'] as const) {
    lines.push(
      `streamgive_notification_deliveries_total{outcome="${outcome}"} ${notificationDeliveries.get(outcome) ?? 0}`,
    );
  }

  lines.push(
    '# HELP streamgive_indexer_unknown_contract_events_total Events dropped because their contract id is not recognised.',
    '# TYPE streamgive_indexer_unknown_contract_events_total counter',
  );
  for (const [contractId, count] of unknownContractEvents) {
    lines.push(
      `streamgive_indexer_unknown_contract_events_total{contract_id="${contractId.replaceAll('"', '\\\\"')}"} ${count}`,
    );
  }

  return `${lines.join('\n')}\n`;
}
