# Save2 Hot + Cold Orchestration

## Flow Summary

1. `hotSave` writes fast to Supabase content store and marks tenant dirty.
2. `save2repo` consolidates dirty changes to GitHub and deploys production.
3. Legacy `/save` and `/save-stream` remain supported during migration.

## Rollout Guards

- `SAVE2ROUTES_BETA`
- `SAVE_HOT_ENABLED`
- `SAVE_REPO_ENABLED`

## Canary Rollout

1. Enable flags for internal tenants only.
2. Validate hot latency (`p95 < 500ms`) and cold completion reliability.
3. Expand to small production cohort.
4. Promote to default after 7-day clean error budget.

## Rollback Strategy

- Toggle flags off:
  - clients fall back to legacy `/save` and `/save-stream`.
- No schema rollback needed for disable-only operation.

## Primary SLOs

- Hot save availability >= 99.9%
- Hot save p95 latency < 500ms
- Cold sync success rate >= 99.5%
- Cold sync timeout rate < 1%

