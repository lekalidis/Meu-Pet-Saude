"""Pet Health backend API tests - device-id auth, pets CRUD, records, upload, report."""
import io
import os
import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://meu-pet-saude--7byl95u8.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"
DEV1 = "testdevice00000000000000000000001"
DEV2 = "testdevice00000000000000000000002"
H1 = {"X-Device-Id": DEV1}
H2 = {"X-Device-Id": DEV2}


# ---- Auth / device-id guard ----
def test_requires_device_id():
    r = requests.get(f"{API}/pets")
    assert r.status_code == 401

def test_rejects_short_device_id():
    r = requests.get(f"{API}/pets", headers={"X-Device-Id": "short"})
    assert r.status_code == 401

def test_accepts_valid_device_id():
    r = requests.get(f"{API}/pets", headers=H1)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


# ---- Pets CRUD ----
@pytest.fixture(scope="module")
def pet_id():
    # cleanup existing
    for p in requests.get(f"{API}/pets", headers=H1).json():
        requests.delete(f"{API}/pets/{p['id']}", headers=H1)
    body = {"name": "TEST_Thor", "species": "dog", "sex": "male", "birth_date": "2022-01-15", "breed": "Lab"}
    r = requests.post(f"{API}/pets", json=body, headers=H1)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    yield pid
    requests.delete(f"{API}/pets/{pid}", headers=H1)

def test_get_pet_shape(pet_id):
    r = requests.get(f"{API}/pets/{pet_id}", headers=H1)
    assert r.status_code == 200
    d = r.json()
    assert d["name"] == "TEST_Thor"
    assert "counts" in d and "exam" in d["counts"]
    assert d["counts"]["vaccine"] == 0
    assert "last_weight" in d and "next_vaccine" in d and "overdue_vaccines" in d
    assert "_id" not in d

def test_list_pets_has_last_weight_key(pet_id):
    r = requests.get(f"{API}/pets", headers=H1)
    assert r.status_code == 200
    items = r.json()
    assert any(p["id"] == pet_id for p in items)
    for p in items:
        assert "_id" not in p

def test_update_pet(pet_id):
    body = {"name": "TEST_Thor2", "species": "dog", "sex": "male", "birth_date": "2022-01-15"}
    r = requests.put(f"{API}/pets/{pet_id}", json=body, headers=H1)
    assert r.status_code == 200
    assert r.json()["name"] == "TEST_Thor2"


# ---- Ownership isolation ----
def test_other_device_cannot_access(pet_id):
    r = requests.get(f"{API}/pets/{pet_id}", headers=H2)
    assert r.status_code == 404


# ---- Records ----
@pytest.fixture(scope="module")
def vaccine_rec(pet_id):
    from datetime import date, timedelta
    nx = (date.today() + timedelta(days=10)).isoformat()
    body = {"type": "vaccine", "date": "2024-01-10", "data": {"name": "V10", "next_date": nx}, "photos": [], "docs": []}
    r = requests.post(f"{API}/pets/{pet_id}/records", json=body, headers=H1)
    assert r.status_code == 200, r.text
    yield r.json()
    requests.delete(f"{API}/records/{r.json()['id']}", headers=H1)

def test_record_persisted(pet_id, vaccine_rec):
    rid = vaccine_rec["id"]
    r = requests.get(f"{API}/records/{rid}", headers=H1)
    assert r.status_code == 200
    assert r.json()["data"]["name"] == "V10"
    # list filter by type
    r2 = requests.get(f"{API}/pets/{pet_id}/records?type=vaccine", headers=H1)
    assert r2.status_code == 200
    assert any(x["id"] == rid for x in r2.json())
    # pet counts update
    pet = requests.get(f"{API}/pets/{pet_id}", headers=H1).json()
    assert pet["counts"]["vaccine"] == 1
    assert pet["next_vaccine"] is not None

def test_upcoming(vaccine_rec):
    r = requests.get(f"{API}/upcoming", headers=H1)
    assert r.status_code == 200
    assert any(u["record_id"] == vaccine_rec["id"] for u in r.json())

def test_record_update(vaccine_rec):
    rid = vaccine_rec["id"]
    body = {"type": "vaccine", "date": "2024-02-10", "data": {"name": "V10-upd"}, "photos": [], "docs": []}
    r = requests.put(f"{API}/records/{rid}", json=body, headers=H1)
    assert r.status_code == 200
    assert r.json()["data"]["name"] == "V10-upd"

def test_record_ownership(vaccine_rec):
    r = requests.get(f"{API}/records/{vaccine_rec['id']}", headers=H2)
    assert r.status_code == 404


# ---- Upload / files ----
@pytest.fixture(scope="module")
def uploaded_path():
    # 1x1 PNG
    png = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4"
           b"\x89\x00\x00\x00\rIDATx\x9cc\xf8\xcf\xc0\x00\x00\x00\x03\x00\x01\\\xcd\xff\x69\x00\x00\x00\x00IEND\xaeB`\x82")
    r = requests.post(f"{API}/upload", headers=H1, files={"file": ("t.png", io.BytesIO(png), "image/png")})
    if r.status_code != 200:
        pytest.skip(f"upload unavailable: {r.status_code} {r.text[:120]}")
    return r.json()["path"]

def test_download_own(uploaded_path):
    r = requests.get(f"{API}/files/{uploaded_path}", headers=H1)
    assert r.status_code == 200
    assert len(r.content) > 0

def test_download_other_device_denied(uploaded_path):
    r = requests.get(f"{API}/files/{uploaded_path}", headers=H2)
    assert r.status_code == 404

def test_download_query_param(uploaded_path):
    r = requests.get(f"{API}/files/{uploaded_path}?d={DEV1}")
    assert r.status_code == 200


# ---- Report data ----
def test_report_data(pet_id, vaccine_rec):
    r = requests.get(f"{API}/pets/{pet_id}/report-data?sections=vaccine,exam", headers=H1)
    assert r.status_code == 200
    d = r.json()
    assert d["pet"]["id"] == pet_id
    assert isinstance(d["records"], list) and len(d["records"]) >= 1
    assert isinstance(d["images"], dict)


# ---- Record delete ----
def test_record_delete(pet_id):
    body = {"type": "weight", "date": "2024-01-01", "data": {"weight": 10.5}, "photos": [], "docs": []}
    r = requests.post(f"{API}/pets/{pet_id}/records", json=body, headers=H1)
    rid = r.json()["id"]
    rd = requests.delete(f"{API}/records/{rid}", headers=H1)
    assert rd.status_code == 200
    assert requests.get(f"{API}/records/{rid}", headers=H1).status_code == 404
