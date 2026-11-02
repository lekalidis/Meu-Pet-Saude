# RevenueCat — integrated (2026-11-02)
Memory for interacting with user's RevenueCat account via integration proxy.

## Identifiers (from /setup response)
- rc_project_id: proj607d0213
- apple_app_id: app009b20502b
- play_app_id: app75a34431c1
- entitlement_lookup_key: pro
- offering_lookup_key: default
- Packages:
  - $rc_monthly -> prodd216dadbf5 ($9.99 / P1M, trial: none)
  - $rc_annual  -> prod1a316a8c05 ($79.99 / P1Y, trial: none)
- Dashboard: https://app.revenuecat.com/projects/proj607d0213
- App identity: anonymous per-device id (secure storage key "device_id") used for Purchases.logIn (no auth in app).

## Status check
curl -sS -H "$AUTH" "$INTEGRATION_PROXY_URL/internal/revenuecat/projects/337571eb-8085-4fc8-b107-c4aa83b4f5e2/status"
If project_state is less than project_created, re-fetch RevenueCat playbook via integration expert.

## Later updates (integration proxy ONLY — never RevenueCat REST API)
- Upsert price/package: POST $INTEGRATION_PROXY_URL/internal/revenuecat/projects/337571eb-8085-4fc8-b107-c4aa83b4f5e2/products
  body: {"products":[{"package":"$rc_monthly","price":14.99,"currency":"USD","period":"P1M","prices":[{"amount_micros":14990000,"currency":"USD"}]}]}
- Remove: DELETE .../products/%24rc_monthly
- Recover identifiers: re-run idempotent /setup.

## Going live (USER does): upload App Store .p8 / Play service JSON in RevenueCat dashboard, set payment profiles,
create matching subscription products in App Store Connect / Play Console with same product IDs, release build, test via TestFlight / internal testing.
All steps are in the FAQ section of the payments panel.
