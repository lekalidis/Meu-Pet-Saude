# Meu Pet Saúde — PRD

## Original problem statement
App for pet tutors to record all their pet's information and share it with the vet: vaccines (date given), weight, birth date, illness episodes (time it started, fever), photos of stool to show the vet — lifelong health tracking.
Follow-up: sell internationally → app in multiple languages switchable by user; paid subscription; exams (ultrasound, X-ray...) with photo or PDF attachments.

## User choices
- Share with vet: PDF report · Multiple pets · Extras: medications, vet visits, weight chart, next vaccine date · Style: cheerful & warm
- Languages: PT, EN, ES, FR, DE · Subscription: Free (1 pet) + Premium (more pets, PDF report, exams) · Billing: App Store / Google Play via RevenueCat · Plans: monthly ($9.99) + annual ($79.99)

## Architecture
- Backend FastAPI + MongoDB (`/app/backend/server.py`): pets, generic records (vaccine, weight, illness, medication, visit, exam) with photos + PDF docs, upcoming vaccines, upload/download via Emergent Object Storage, report-data (base64 images).
- Identity: anonymous per-device id (secure storage) sent as `X-Device-Id`; also used as RevenueCat app user id.
- Frontend Expo Router stack: home, pet-form, pet/[id] dashboard, pet/[id]/[type] lists (+weight chart), record-form (generic), pet/[id]/report (PDF via expo-print + expo-sharing, HTML built on device in current language), settings (language + plan + restore), paywall.
- i18n: `src/i18n.ts` (5 dictionaries), `src/lang.tsx` provider; dates localized (MM/DD/YYYY in English).
- RevenueCat: `src/revenuecat.tsx`, entitlement `pro`, client-side gating only. See `/app/memory/revenuecat.md`.

## Implemented (2026-11-02)
- All features above; tested backend 16/16, frontend core flows, paywall offerings load from Test Store.

## Backlog
- P1: Login/account so data survives reinstall and syncs across devices
- P1: lb/°F units for US users
- P1: Local reminders for vaccine boosters & medication times
- P2: Shareable web link for the vet; vet clinic directory
