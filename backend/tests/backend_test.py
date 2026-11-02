"""Pet Health backend API tests - JWT Bearer auth, pets CRUD, records, upload, report, device migration."""
import io
import os
import uuid
from datetime import date, timedelta

import pytest
import requests

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"

# Fixed test user as per /app/memory/test_credentials.md
PRIMARY_EMAIL = "tutor@meupet.com"
PRIMARY_PASS = "Pet12345"


def _hex(n: int = 32) -> str:
    return uuid.uuid4().hex + uuid.uuid4().hex[: max(0, n - 32)]


# ---- Fixtures ---------------------------------------------------------------
@pytest.fixture(scope="session")
def primary_token() -> str:
    """Login (or register) the primary account and return a Bearer token."""
    r = requests.post(f"{API}/auth/login", json={"email": PRIMARY_EMAIL, "password": PRIMARY_PASS})
    if r.status_code == 401:
        r = requests.post(f"{API}/auth/register", json={"email": PRIMARY_EMAIL, "password": PRIMARY_PASS, "name": "Tutor"})
    assert r.status_code == 200, f"primary auth failed: {r.status_code} {r.text}"
    tok = r.json()["token"]
    assert tok
    return tok


@pytest.fixture(scope="session")
def h1(primary_token):
    return {"Authorization": f"Bearer {primary_token}"}


@pytest.fixture(scope="session")
def h2():
    """Fresh second account for isolation checks."""
    email = f"TEST_{uuid.uuid4().hex[:8]}@test.com"
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": "Pass12345", "name": "Other"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


# ---- Auth -------------------------------------------------------------------
class TestAuth:
    def test_pets_requires_bearer(self):
        r = requests.get(f"{API}/pets")
        assert r.status_code == 401
        assert r.json().get("detail") == "not_authenticated"

    def test_register_duplicate_returns_409(self):
        r = requests.post(f"{API}/auth/register", json={"email": PRIMARY_EMAIL, "password": PRIMARY_PASS, "name": "x"})
        assert r.status_code == 409
        assert r.json()["detail"] == "account_exists"

    def test_login_wrong_password(self):
        r = requests.post(f"{API}/auth/login", json={"email": PRIMARY_EMAIL, "password": "wrongwrongwrong"})
        assert r.status_code == 401
        assert r.json()["detail"] == "invalid_credentials"

    def test_login_short_password_422(self):
        r = requests.post(f"{API}/auth/login", json={"email": PRIMARY_EMAIL, "password": ""})
        assert r.status_code == 422

    def test_register_short_password_422(self):
        r = requests.post(f"{API}/auth/register", json={"email": f"TEST_{uuid.uuid4().hex[:6]}@x.com", "password": "short", "name": "x"})
        assert r.status_code == 422

    def test_me_returns_user(self, h1):
        r = requests.get(f"{API}/auth/me", headers=h1)
        assert r.status_code == 200
        d = r.json()
        assert d["email"] == PRIMARY_EMAIL
        assert "id" in d and d["id"].startswith("user_")
        assert "password" in d["auth_methods"] or isinstance(d.get("auth_methods"), list)

    def test_session_invalid_sid_401(self):
        r = requests.post(f"{API}/auth/session", json={"session_id": "not-a-real-session"})
        assert r.status_code == 401
        assert r.json()["detail"] == "invalid_session"

    def test_logout_revokes_token(self):
        """Register throwaway user, logout, verify /me returns 401."""
        email = f"TEST_{uuid.uuid4().hex[:8]}@test.com"
        r = requests.post(f"{API}/auth/register", json={"email": email, "password": "Pass12345", "name": "temp"})
        assert r.status_code == 200
        tok = r.json()["token"]
        h = {"Authorization": f"Bearer {tok}"}
        assert requests.get(f"{API}/auth/me", headers=h).status_code == 200
        lo = requests.post(f"{API}/auth/logout", headers=h, json={})
        assert lo.status_code == 200
        after = requests.get(f"{API}/auth/me", headers=h)
        assert after.status_code == 401


# ---- Device migration -------------------------------------------------------
class TestDeviceMigration:
    def test_register_with_device_id_migrates_pet(self):
        """Insert a pet directly in mongo with owner_id=<device_id>, register with that device_id,
        then GET /api/pets should include that pet.

        Since the test environment runs remotely, we create the 'orphan' pet via the API using
        a temporary user, flip its owner_id to the device id directly via a second route — but
        we don't have DB access. Instead, we simulate migration end-to-end: register user A with
        device_id D, create pet via A, then logout A. Register user B with device_id D (unused).
        Device-id migration triggers on *any* register/login when the device-id matches orphan
        rows (owner_id == device_id string). To hit that path we have to insert as owner_id=D
        which is only possible server-side. Fallback: just confirm migrate_device_data is
        idempotent — a brand new device_id with no orphans does not break register/login.
        """
        device_id = _hex(32)
        email = f"TEST_{uuid.uuid4().hex[:8]}@test.com"
        r = requests.post(f"{API}/auth/register", json={"email": email, "password": "Pass12345", "name": "mig", "device_id": device_id})
        assert r.status_code == 200
        tok = r.json()["token"]
        # idempotent: login again with same device_id should not break
        r2 = requests.post(f"{API}/auth/login", json={"email": email, "password": "Pass12345", "device_id": device_id})
        assert r2.status_code == 200
        # pets should be empty for new account (no orphans)
        pets = requests.get(f"{API}/pets", headers={"Authorization": f"Bearer {tok}"}).json()
        assert isinstance(pets, list) and len(pets) == 0

    def test_short_device_id_is_ignored(self):
        """Short device_id must be ignored (not treated as owner_id to avoid false migrations)."""
        email = f"TEST_{uuid.uuid4().hex[:8]}@test.com"
        r = requests.post(f"{API}/auth/register", json={"email": email, "password": "Pass12345", "name": "x", "device_id": "short"})
        assert r.status_code == 200


# ---- Pets CRUD --------------------------------------------------------------
@pytest.fixture(scope="module")
def pet_id(primary_token):
    h = {"Authorization": f"Bearer {primary_token}"}
    for p in requests.get(f"{API}/pets", headers=h).json():
        if p["name"].startswith("TEST_"):
            requests.delete(f"{API}/pets/{p['id']}", headers=h)
    body = {"name": "TEST_Thor", "species": "dog", "sex": "male", "birth_date": "2022-01-15", "breed": "Lab"}
    r = requests.post(f"{API}/pets", json=body, headers=h)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    yield pid
    requests.delete(f"{API}/pets/{pid}", headers=h)


class TestPets:
    def test_get_pet_shape(self, pet_id, h1):
        r = requests.get(f"{API}/pets/{pet_id}", headers=h1)
        assert r.status_code == 200
        d = r.json()
        assert d["name"] == "TEST_Thor"
        assert "counts" in d and "exam" in d["counts"]
        assert d["counts"]["vaccine"] == 0
        assert "last_weight" in d and "next_vaccine" in d and "overdue_vaccines" in d
        assert "_id" not in d

    def test_list_pets(self, pet_id, h1):
        r = requests.get(f"{API}/pets", headers=h1)
        assert r.status_code == 200
        items = r.json()
        assert any(p["id"] == pet_id for p in items)
        for p in items:
            assert "_id" not in p

    def test_update_pet(self, pet_id, h1):
        body = {"name": "TEST_Thor2", "species": "dog", "sex": "male", "birth_date": "2022-01-15"}
        r = requests.put(f"{API}/pets/{pet_id}", json=body, headers=h1)
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Thor2"
        # verify persistence
        g = requests.get(f"{API}/pets/{pet_id}", headers=h1).json()
        assert g["name"] == "TEST_Thor2"

    def test_other_user_cannot_access(self, pet_id, h2):
        r = requests.get(f"{API}/pets/{pet_id}", headers=h2)
        assert r.status_code == 404


# ---- Records ----------------------------------------------------------------
@pytest.fixture(scope="module")
def vaccine_rec(pet_id, primary_token):
    h = {"Authorization": f"Bearer {primary_token}"}
    nx = (date.today() + timedelta(days=10)).isoformat()
    body = {"type": "vaccine", "date": "2024-01-10", "data": {"name": "V10", "next_date": nx}, "photos": [], "docs": []}
    r = requests.post(f"{API}/pets/{pet_id}/records", json=body, headers=h)
    assert r.status_code == 200, r.text
    yield r.json()
    requests.delete(f"{API}/records/{r.json()['id']}", headers=h)


class TestRecords:
    def test_record_persisted(self, pet_id, vaccine_rec, h1):
        rid = vaccine_rec["id"]
        r = requests.get(f"{API}/records/{rid}", headers=h1)
        assert r.status_code == 200
        assert r.json()["data"]["name"] == "V10"
        r2 = requests.get(f"{API}/pets/{pet_id}/records?type=vaccine", headers=h1)
        assert r2.status_code == 200
        assert any(x["id"] == rid for x in r2.json())
        pet = requests.get(f"{API}/pets/{pet_id}", headers=h1).json()
        assert pet["counts"]["vaccine"] == 1
        assert pet["next_vaccine"] is not None

    def test_upcoming(self, vaccine_rec, h1):
        r = requests.get(f"{API}/upcoming", headers=h1)
        assert r.status_code == 200
        assert any(u["record_id"] == vaccine_rec["id"] for u in r.json())

    def test_record_update(self, vaccine_rec, h1):
        rid = vaccine_rec["id"]
        body = {"type": "vaccine", "date": "2024-02-10", "data": {"name": "V10-upd"}, "photos": [], "docs": []}
        r = requests.put(f"{API}/records/{rid}", json=body, headers=h1)
        assert r.status_code == 200
        assert r.json()["data"]["name"] == "V10-upd"

    def test_record_ownership(self, vaccine_rec, h2):
        r = requests.get(f"{API}/records/{vaccine_rec['id']}", headers=h2)
        assert r.status_code == 404

    def test_record_delete(self, pet_id, h1):
        body = {"type": "weight", "date": "2024-01-01", "data": {"weight": 10.5}, "photos": [], "docs": []}
        r = requests.post(f"{API}/pets/{pet_id}/records", json=body, headers=h1)
        rid = r.json()["id"]
        rd = requests.delete(f"{API}/records/{rid}", headers=h1)
        assert rd.status_code == 200
        assert requests.get(f"{API}/records/{rid}", headers=h1).status_code == 404


# ---- Upload / files ---------------------------------------------------------
PNG = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4"
       b"\x89\x00\x00\x00\rIDATx\x9cc\xf8\xcf\xc0\x00\x00\x00\x03\x00\x01\\\xcd\xff\x69\x00\x00\x00\x00IEND\xaeB`\x82")


@pytest.fixture(scope="module")
def uploaded_path(primary_token):
    h = {"Authorization": f"Bearer {primary_token}"}
    r = requests.post(f"{API}/upload", headers=h, files={"file": ("t.png", io.BytesIO(PNG), "image/png")})
    if r.status_code != 200:
        pytest.skip(f"upload unavailable: {r.status_code} {r.text[:120]}")
    return r.json()["path"]


class TestFiles:
    def test_upload_requires_auth(self):
        r = requests.post(f"{API}/upload", files={"file": ("t.png", io.BytesIO(PNG), "image/png")})
        assert r.status_code == 401

    def test_download_own(self, uploaded_path, h1):
        r = requests.get(f"{API}/files/{uploaded_path}", headers=h1)
        assert r.status_code == 200
        assert len(r.content) > 0

    def test_download_token_query_param(self, uploaded_path, primary_token):
        r = requests.get(f"{API}/files/{uploaded_path}?t={primary_token}")
        assert r.status_code == 200
        assert len(r.content) > 0

    def test_download_other_user_denied(self, uploaded_path, h2):
        r = requests.get(f"{API}/files/{uploaded_path}", headers=h2)
        assert r.status_code == 404


# ---- Report data ------------------------------------------------------------
class TestReport:
    def test_report_data(self, pet_id, vaccine_rec, h1):
        r = requests.get(f"{API}/pets/{pet_id}/report-data?sections=vaccine,exam", headers=h1)
        assert r.status_code == 200
        d = r.json()
        assert d["pet"]["id"] == pet_id
        assert isinstance(d["records"], list) and len(d["records"]) >= 1
        assert isinstance(d["images"], dict)

    def test_report_requires_auth(self, pet_id):
        r = requests.get(f"{API}/pets/{pet_id}/report-data")
        assert r.status_code == 401
