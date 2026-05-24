# Custom Domains SLO

## Indicators

- `api_domain_add_success_ratio`
- `api_domain_verify_latency_ms`
- `api_domain_remove_success_ratio`
- `domain_dlq_backlog_count`
- `domain_verifying_stuck_count`

## Objectives

- Success ratio (`add/remove`) >= 99.0% per 30-day window
- p95 `verify` latency <= 5s for API call lifecycle
- DLQ backlog <= 25 pending items for >= 99% of 30-day window
- Stuck verifying domains (>60m) <= 1% of active pending/verifying set

## Notes

- External DNS propagation time is excluded from API success latency objectives
- Retry/backoff and reconcile job are part of error budget burn mitigation
- Correlation IDs must be propagated end-to-end (`x-correlation-id`)
