"""Iteration 3 tests: forgot/reset password, grooming records, /api/reminders."""
import os
import uuid
from datetime import date, datetime, timedelta, timezone

import bcrypt
import pytest
import requests
from pymongo import MongoClient

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

PRIMARY_EMAIL = "tutor@meupet.com"
PRIMARY_PASS = "Pet12345"


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="module")
def primary_token():
    r = requests.post(f"{API}/auth/login", json={"email": PRIMARY_EMAIL, "password": PRIMARY_PASS})
    if r.status_code != 200:
        r = requests.post(f"{API}/auth/register", json={"email": PRIMARY_EMAIL, "password": PRIMARY_PASS, "name": "Tutor"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def h1(primary_token):
    return {"Authorization": f"Bearer {primary_token}"}


# ---------------- Forgot / Reset ----------------
class TestForgot:
    def test_forgot_unknown_email_returns_ok(self):
        r = requests.post(f"{API}/auth/forgot", json={"email": f"nobody_{uuid.uuid4().hex[:8]}@example.com", "lang": "en"})
        assert r.status_code == 200
        assert r.json() == {"ok": True}

    def test_forgot_known_email_creates_doc_and_rate_limits(self, mongo):
        """Use delivered@resend.dev-like scheme; create a throwaway known user via API."""
        email = f"test_{uuid.uuid4().hex[:8]}@example.com"
        reg = requests.post(f"{API}/auth/register", json={"email": email, "password": "OldPass123", "name": "fp"})
        assert reg.status_code == 200
        # trigger forgot - the Resend send may fail for @example.com; endpoint still returns ok after writing the doc,
        # but if provider rejects, send_email raises before return and we get 502. Accept both outcomes but assert
        # the DB side-effect if we got 200.
        r1 = requests.post(f"{API}/auth/forgot", json={"email": email, "lang": "en"})
        if r1.status_code == 502:
            pytest.skip("Email provider rejected example.com; cannot assert code generation.")
        assert r1.status_code == 200
        doc = mongo.password_resets.find_one({"email": email})
        assert doc is not None
        assert doc.get("attempts") == 0
        # rate-limit: second call within 60s must still return ok but keep the same code doc.
        r2 = requests.post(f"{API}/auth/forgot", json={"email": email, "lang": "en"})
        assert r2.status_code == 200
        doc2 = mongo.password_resets.find_one({"email": email})
        assert doc2["_id"] == doc["_id"], "rate-limited call should not replace the reset doc"
        # cleanup
        mongo.password_resets.delete_many({"email": email})

    def test_reset_wrong_code_increments_attempts_and_expires_after_5(self, mongo):
        """Insert our own bcrypt-hashed code so we can control it, then verify wrong-code paths."""
        email = f"test_{uuid.uuid4().hex[:8]}@example.com"
        assert requests.post(f"{API}/auth/register", json={"email": email, "password": "OldPass123", "name": "fp2"}).status_code == 200
        real_code = "123456"
        mongo.password_resets.delete_many({"email": email})
        mongo.password_resets.insert_one({
            "email": email,
            "code_hash": bcrypt.hashpw(real_code.encode(), bcrypt.gensalt()).decode(),
            "attempts": 0,
            "created_at": datetime.now(timezone.utc),
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=15),
        })
        # 5 wrong attempts -> invalid_code each; 6th -> code_expired
        for i in range(5):
            r = requests.post(f"{API}/auth/reset", json={"email": email, "code": "000000", "password": "NewPass1234"})
            assert r.status_code == 400
            assert r.json()["detail"] == "invalid_code", f"attempt {i}"
        r6 = requests.post(f"{API}/auth/reset", json={"email": email, "code": "000000", "password": "NewPass1234"})
        assert r6.status_code == 400
        assert r6.json()["detail"] == "code_expired"
        # doc deleted after expiry
        assert mongo.password_resets.find_one({"email": email}) is None

    def test_reset_correct_code_changes_password(self, mongo):
        email = f"test_{uuid.uuid4().hex[:8]}@example.com"
        old_pw, new_pw = "OldPass123", "BrandNewPass9"
        assert requests.post(f"{API}/auth/register", json={"email": email, "password": old_pw, "name": "fp3"}).status_code == 200
        code = "654321"
        mongo.password_resets.delete_many({"email": email})
        mongo.password_resets.insert_one({
            "email": email,
            "code_hash": bcrypt.hashpw(code.encode(), bcrypt.gensalt()).decode(),
            "attempts": 0,
            "created_at": datetime.now(timezone.utc),
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=15),
        })
        r = requests.post(f"{API}/auth/reset", json={"email": email, "code": code, "password": new_pw})
        assert r.status_code == 200, r.text
        body = r.json()
        assert "token" in body and body["user"]["email"] == email
        # old password rejected
        assert requests.post(f"{API}/auth/login", json={"email": email, "password": old_pw}).status_code == 401
        # new password accepted
        assert requests.post(f"{API}/auth/login", json={"email": email, "password": new_pw}).status_code == 200
        # one-shot: reset doc consumed
        assert mongo.password_resets.find_one({"email": email}) is None

    def test_reset_short_password_422(self):
        r = requests.post(f"{API}/auth/reset", json={"email": "x@example.com", "code": "123456", "password": "short"})
        assert r.status_code == 422

    def test_reset_bad_code_length_422(self):
        r = requests.post(f"{API}/auth/reset", json={"email": "x@example.com", "code": "123", "password": "longenough1"})
        assert r.status_code == 422


# ---------------- Grooming + reminders ----------------
@pytest.fixture(scope="module")
def pet_id(h1):
    # cleanup prior TEST_Groom pets
    for p in requests.get(f"{API}/pets", headers=h1).json():
        if p["name"].startswith("TEST_Groom"):
            requests.delete(f"{API}/pets/{p['id']}", headers=h1)
    body = {"name": "TEST_Groom", "species": "dog", "sex": "male", "birth_date": "2022-01-15"}
    r = requests.post(f"{API}/pets", json=body, headers=h1)
    assert r.status_code == 200
    pid = r.json()["id"]
    yield pid
    requests.delete(f"{API}/pets/{pid}", headers=h1)


class TestGrooming:
    def test_create_grooming_record(self, pet_id, h1):
        today = date.today().isoformat()
        body = {"type": "grooming", "date": today, "data": {"kind": "bath", "place": "PetShop", "remind_days": 30}, "photos": [], "docs": []}
        r = requests.post(f"{API}/pets/{pet_id}/records", json=body, headers=h1)
        assert r.status_code == 200, r.text
        rec = r.json()
        assert rec["type"] == "grooming"
        assert rec["data"]["kind"] == "bath"
        assert rec["data"]["remind_days"] == 30

    def test_pet_counts_include_grooming(self, pet_id, h1):
        r = requests.get(f"{API}/pets/{pet_id}", headers=h1)
        assert r.status_code == 200
        counts = r.json()["counts"]
        assert "grooming" in counts
        assert counts["grooming"] >= 1

    def test_reminders_include_grooming_future(self, pet_id, h1):
        r = requests.get(f"{API}/reminders", headers=h1)
        assert r.status_code == 200
        items = r.json()
        # should include our grooming due today+30 days
        groom = [i for i in items if i["type"] == "grooming" and i.get("pet_name") == "TEST_Groom"]
        assert len(groom) >= 1, items
        expected = (date.today() + timedelta(days=30)).isoformat()
        assert groom[0]["date"] == expected
        assert "pet_name" in groom[0]

    def test_reminders_include_vaccine_next_date(self, pet_id, h1):
        nx = (date.today() + timedelta(days=14)).isoformat()
        body = {"type": "vaccine", "date": "2024-01-10", "data": {"name": "TEST_V", "next_date": nx}, "photos": [], "docs": []}
        rp = requests.post(f"{API}/pets/{pet_id}/records", json=body, headers=h1)
        assert rp.status_code == 200
        r = requests.get(f"{API}/reminders", headers=h1)
        assert r.status_code == 200
        items = r.json()
        v = [i for i in items if i["type"] == "vaccine" and i["pet_name"] == "TEST_Groom" and i["date"] == nx]
        assert len(v) == 1, items

    def test_reminders_excludes_past_grooming(self, pet_id, h1):
        """Grooming date in the past where date+remind_days is still in past should be excluded."""
        past = (date.today() - timedelta(days=60)).isoformat()
        body = {"type": "grooming", "date": past, "data": {"kind": "both", "remind_days": 10}, "photos": [], "docs": []}
        rp = requests.post(f"{API}/pets/{pet_id}/records", json=body, headers=h1)
        assert rp.status_code == 200
        r = requests.get(f"{API}/reminders", headers=h1)
        for i in r.json():
            if i["type"] == "grooming":
                assert i["date"] >= date.today().isoformat()
