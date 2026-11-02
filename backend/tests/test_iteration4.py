"""Iteration 4 tests: parasite record type, counts incl. parasite+grooming, reminders for medication(times)/parasite/vaccine/grooming."""
import os
import uuid
from datetime import date, timedelta

import pytest
import requests

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"

PRIMARY_EMAIL = "tutor@meupet.com"
PRIMARY_PASS = "Pet12345"


@pytest.fixture(scope="module")
def primary_token():
    r = requests.post(f"{API}/auth/login", json={"email": PRIMARY_EMAIL, "password": PRIMARY_PASS})
    if r.status_code != 200:
        r = requests.post(f"{API}/auth/register", json={"email": PRIMARY_EMAIL, "password": PRIMARY_PASS, "name": "Tutor"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def h(primary_token):
    return {"Authorization": f"Bearer {primary_token}"}


@pytest.fixture(scope="module")
def pet_id(h):
    # clean prior
    for p in requests.get(f"{API}/pets", headers=h).json():
        if p["name"].startswith("TEST_Iter4"):
            requests.delete(f"{API}/pets/{p['id']}", headers=h)
    body = {"name": f"TEST_Iter4_{uuid.uuid4().hex[:6]}", "species": "dog"}
    r = requests.post(f"{API}/pets", json=body, headers=h)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    yield pid
    requests.delete(f"{API}/pets/{pid}", headers=h)


class TestParasiteRecord:
    def test_create_parasite_dewormer(self, pet_id, h):
        today = date.today().isoformat()
        nx = (date.today() + timedelta(days=90)).isoformat()
        body = {
            "type": "parasite",
            "date": today,
            "data": {"kind": "dewormer", "product": "TEST_Drontal", "next_date": nx, "cost": 45.9},
            "photos": [], "docs": [],
        }
        r = requests.post(f"{API}/pets/{pet_id}/records", json=body, headers=h)
        assert r.status_code == 200, r.text
        rec = r.json()
        assert rec["type"] == "parasite"
        assert rec["data"]["kind"] == "dewormer"
        assert rec["data"]["product"] == "TEST_Drontal"
        assert rec["data"]["next_date"] == nx
        assert rec["data"]["cost"] == 45.9

    def test_create_parasite_antiflea(self, pet_id, h):
        body = {
            "type": "parasite",
            "date": date.today().isoformat(),
            "data": {"kind": "antiflea", "product": "TEST_Bravecto", "cost": 120.0},
            "photos": [], "docs": [],
        }
        r = requests.post(f"{API}/pets/{pet_id}/records", json=body, headers=h)
        assert r.status_code == 200, r.text
        assert r.json()["data"]["kind"] == "antiflea"

    def test_list_records_filtered_parasite(self, pet_id, h):
        r = requests.get(f"{API}/pets/{pet_id}/records?type=parasite", headers=h)
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 2
        assert all(x["type"] == "parasite" for x in items)

    def test_invalid_record_type_rejected(self, pet_id, h):
        body = {"type": "bogus", "date": date.today().isoformat(), "data": {}, "photos": [], "docs": []}
        r = requests.post(f"{API}/pets/{pet_id}/records", json=body, headers=h)
        assert r.status_code == 422


class TestPetCounts:
    def test_counts_include_parasite_and_grooming(self, pet_id, h):
        # add a grooming entry too
        requests.post(f"{API}/pets/{pet_id}/records", json={
            "type": "grooming", "date": date.today().isoformat(),
            "data": {"kind": "bath", "remind_days": 30}, "photos": [], "docs": [],
        }, headers=h)
        r = requests.get(f"{API}/pets/{pet_id}", headers=h)
        assert r.status_code == 200
        counts = r.json()["counts"]
        for t in ("vaccine", "weight", "illness", "medication", "visit", "exam", "grooming", "parasite"):
            assert t in counts, f"missing count key: {t}"
        assert counts["parasite"] >= 2
        assert counts["grooming"] >= 1


class TestReminders:
    def test_reminders_include_parasite_next_date(self, pet_id, h):
        r = requests.get(f"{API}/reminders", headers=h)
        assert r.status_code == 200
        items = r.json()
        pz = [i for i in items if i["type"] == "parasite"]
        assert len(pz) >= 1, items
        # name should use product fallback
        assert any(i.get("name") for i in pz)
        # all future-only
        today = date.today().isoformat()
        for i in pz:
            assert i["date"] >= today

    def test_reminders_include_medication_only_if_times_and_future(self, pet_id, h):
        # medication with times -> SHOULD show
        future_end = (date.today() + timedelta(days=5)).isoformat()
        r1 = requests.post(f"{API}/pets/{pet_id}/records", json={
            "type": "medication", "date": date.today().isoformat(),
            "data": {"name": "TEST_MedA", "dose": "1 pill", "times": "08:00, 20:00", "end_date": future_end},
            "photos": [], "docs": [],
        }, headers=h)
        assert r1.status_code == 200
        # medication w/o times -> should NOT show
        r2 = requests.post(f"{API}/pets/{pet_id}/records", json={
            "type": "medication", "date": date.today().isoformat(),
            "data": {"name": "TEST_MedNoTimes", "dose": "1 pill"}, "photos": [], "docs": [],
        }, headers=h)
        assert r2.status_code == 200
        # medication with past end_date -> should NOT show
        past_end = (date.today() - timedelta(days=1)).isoformat()
        r3 = requests.post(f"{API}/pets/{pet_id}/records", json={
            "type": "medication", "date": "2024-01-01",
            "data": {"name": "TEST_MedExpired", "times": "09:00", "end_date": past_end},
            "photos": [], "docs": [],
        }, headers=h)
        assert r3.status_code == 200

        rr = requests.get(f"{API}/reminders", headers=h)
        assert rr.status_code == 200
        meds = [i for i in rr.json() if i["type"] == "medication"]
        names = [m["name"] for m in meds]
        assert "TEST_MedA" in names
        assert "TEST_MedNoTimes" not in names
        assert "TEST_MedExpired" not in names
        # medication entry has times, dose, end fields
        a = next(m for m in meds if m["name"] == "TEST_MedA")
        assert a["times"] == "08:00, 20:00"
        assert a["dose"] == "1 pill"
        assert a["end"] == future_end

    def test_reminders_include_vaccine_and_grooming(self, pet_id, h):
        nx = (date.today() + timedelta(days=20)).isoformat()
        requests.post(f"{API}/pets/{pet_id}/records", json={
            "type": "vaccine", "date": "2024-05-01",
            "data": {"name": "TEST_V_Iter4", "next_date": nx}, "photos": [], "docs": [],
        }, headers=h)
        r = requests.get(f"{API}/reminders", headers=h)
        items = r.json()
        assert any(i["type"] == "vaccine" and i["date"] == nx for i in items)
        assert any(i["type"] == "grooming" for i in items)
        # sorted ascending by date
        dates = [i["date"] for i in items]
        assert dates == sorted(dates)
