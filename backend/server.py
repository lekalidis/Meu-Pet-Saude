from fastapi import FastAPI, APIRouter, Header, HTTPException, UploadFile, File, Query
from fastapi.responses import Response
from fastapi.concurrency import run_in_threadpool
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
import os
import base64
import logging
import uuid
import secrets
import requests
import bcrypt
import httpx
import jwt
from pymongo.errors import DuplicateKeyError
from pathlib import Path
from pydantic import BaseModel, Field, BeforeValidator, ConfigDict, EmailStr
from typing import Annotated, Any, Dict, List, Literal, Optional
from datetime import datetime, timezone, date, timedelta

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from email_service import send_email, reset_email  # noqa: E402

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ---------------- Object storage ----------------
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = "meu-pet-saude"
storage_key = None


def init_storage():
    global storage_key
    if storage_key:
        return storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    storage_key = resp.json()["storage_key"]
    return storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(f"{STORAGE_URL}/objects/{path}",
                        headers={"X-Storage-Key": key, "Content-Type": content_type}, data=data, timeout=120)
    resp.raise_for_status()
    return resp.json()


def get_object(path: str):
    key = init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


# ---------------- Models ----------------
PyObjectId = Annotated[str, BeforeValidator(lambda v: str(v) if isinstance(v, ObjectId) else v)]


class BaseDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: Optional[PyObjectId] = Field(default=None, alias="_id")

    @classmethod
    def from_mongo(cls, doc: dict):
        return cls.model_validate(doc)

    def to_mongo(self) -> dict:
        d = self.model_dump(by_alias=True, exclude={"id"})
        d.pop("_id", None)
        return d

    def out(self) -> dict:
        return self.model_dump(by_alias=False)


class PetIn(BaseModel):
    name: str
    species: str = "Cachorro"
    breed: str = ""
    sex: str = ""
    birth_date: Optional[str] = None  # YYYY-MM-DD
    color: str = ""
    microchip: str = ""
    notes: str = ""
    photo: Optional[str] = None  # storage path


class Pet(BaseDocument, PetIn):
    owner_id: str
    created_at: str


RecordType = Literal["vaccine", "weight", "illness", "medication", "visit", "exam", "grooming"]


class RecordIn(BaseModel):
    type: RecordType
    date: str  # YYYY-MM-DD or YYYY-MM-DDTHH:MM
    data: Dict[str, Any] = {}
    photos: List[str] = []
    docs: List[Dict[str, str]] = []  # [{"path","name"}] PDF attachments


class Record(BaseDocument, RecordIn):
    pet_id: str
    owner_id: str
    created_at: str


# ---------------- App ----------------
app = FastAPI()


@app.get("/health", include_in_schema=False)
@app.head("/health", include_in_schema=False)
async def health():
    return {"status": "ok"}


api_router = APIRouter(prefix="/api")


def oid(v: str) -> ObjectId:
    if not ObjectId.is_valid(v):
        raise HTTPException(status_code=404, detail="Não encontrado")
    return ObjectId(v)


async def get_pet_doc(pet_id: str, owner_id: str) -> dict:
    doc = await db.pets.find_one({"_id": oid(pet_id), "owner_id": owner_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Pet não encontrado")
    return doc


@api_router.get("/")
async def root():
    return {"message": "Meu Pet Saúde API"}


# ---------------- Auth (email/password JWT + Emergent Google) ----------------
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ISS, JWT_AUD = "meupet-api", "meupet-app"
JWT_DAYS = 30
EMERGENT_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=256)
    name: str = ""
    device_id: Optional[str] = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)
    device_id: Optional[str] = None


class SessionIn(BaseModel):
    session_id: str
    device_id: Optional[str] = None


def public_user(u: dict) -> dict:
    return {"id": u["user_id"], "email": u["email"], "name": u.get("name", ""),
            "picture": u.get("picture"), "auth_methods": u.get("auth_methods", [])}


def make_jwt(user_id: str) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": user_id, "jti": uuid.uuid4().hex, "iat": now, "exp": now + timedelta(days=JWT_DAYS),
                       "iss": JWT_ISS, "aud": JWT_AUD}, JWT_SECRET, algorithm="HS256")


def bearer_token(authorization: Optional[str]) -> Optional[str]:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip() or None
    return None


async def resolve_user(token: Optional[str]) -> Optional[dict]:
    if not token:
        return None
    s = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if s:
        exp = s["expires_at"]
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < datetime.now(timezone.utc):
            return None
        return await db.users.find_one({"user_id": s["user_id"]}, {"_id": 0})
    try:
        p = jwt.decode(token, JWT_SECRET, algorithms=["HS256"], audience=JWT_AUD, issuer=JWT_ISS)
    except jwt.PyJWTError:
        return None
    if await db.revoked_tokens.find_one({"jti": p.get("jti")}):
        return None
    return await db.users.find_one({"user_id": p.get("sub")}, {"_id": 0})


async def auth_user_id(authorization: Optional[str], token_q: Optional[str] = None) -> str:
    user = await resolve_user(bearer_token(authorization) or token_q)
    if not user:
        raise HTTPException(status_code=401, detail="not_authenticated")
    return user["user_id"]


async def migrate_device_data(device_id: Optional[str], user_id: str):
    """Move data created before login (keyed by the anonymous device id) to the account. Idempotent."""
    if not device_id or len(device_id) < 16 or device_id.startswith("user_"):
        return
    for coll in (db.pets, db.records, db.files):
        await coll.update_many({"owner_id": device_id}, {"$set": {"owner_id": user_id}})


@api_router.post("/auth/register")
async def register(body: RegisterIn):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="account_exists")
    user = {"user_id": f"user_{uuid.uuid4().hex[:12]}", "email": email, "name": body.name.strip(),
            "password_hash": bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode(),
            "auth_methods": ["password"], "created_at": datetime.now(timezone.utc).isoformat()}
    try:
        await db.users.insert_one(dict(user))
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="account_exists")
    await migrate_device_data(body.device_id, user["user_id"])
    return {"token": make_jwt(user["user_id"]), "user": public_user(user)}


@api_router.post("/auth/login")
async def login(body: LoginIn):
    user = await db.users.find_one({"email": body.email.lower()}, {"_id": 0})
    ok = bool(user and user.get("password_hash")) and bcrypt.checkpw(body.password.encode(), user["password_hash"].encode())
    if not ok:
        raise HTTPException(status_code=401, detail="invalid_credentials")
    await migrate_device_data(body.device_id, user["user_id"])
    return {"token": make_jwt(user["user_id"]), "user": public_user(user)}


@api_router.post("/auth/session")
async def google_session(body: SessionIn):
    async with httpx.AsyncClient(timeout=20) as hc:
        r = await hc.get(EMERGENT_SESSION_URL, headers={"X-Session-ID": body.session_id})
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="invalid_session")
    d = r.json()
    email = d["email"].lower()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if user:
        await db.users.update_one({"user_id": user["user_id"]},
                                  {"$addToSet": {"auth_methods": "google"},
                                   "$set": {"picture": d.get("picture"), "name": user.get("name") or d.get("name", "")}})
        user = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    else:
        user = {"user_id": f"user_{uuid.uuid4().hex[:12]}", "email": email, "name": d.get("name", ""),
                "picture": d.get("picture"), "auth_methods": ["google"], "created_at": datetime.now(timezone.utc).isoformat()}
        await db.users.insert_one(dict(user))
    now = datetime.now(timezone.utc)
    await db.user_sessions.insert_one({"session_token": d["session_token"], "user_id": user["user_id"],
                                       "expires_at": now + timedelta(days=7), "created_at": now})
    await migrate_device_data(body.device_id, user["user_id"])
    return {"token": d["session_token"], "user": public_user(user)}


@api_router.get("/auth/me")
async def me(authorization: Optional[str] = Header(None)):
    user = await resolve_user(bearer_token(authorization))
    if not user:
        raise HTTPException(status_code=401, detail="not_authenticated")
    return public_user(user)


@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    token = bearer_token(authorization)
    if token:
        res = await db.user_sessions.delete_one({"session_token": token})
        if res.deleted_count == 0:
            try:
                p = jwt.decode(token, JWT_SECRET, algorithms=["HS256"], audience=JWT_AUD, issuer=JWT_ISS)
                await db.revoked_tokens.insert_one({"jti": p["jti"], "expires_at": datetime.fromtimestamp(p["exp"], timezone.utc)})
            except jwt.PyJWTError:
                pass
    return {"ok": True}


class ForgotIn(BaseModel):
    email: EmailStr
    lang: str = "en"


class ResetIn(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)
    password: str = Field(min_length=8, max_length=256)


@api_router.post("/auth/forgot")
async def forgot_password(body: ForgotIn):
    """Emails a 6-digit code. Always returns ok so emails can't be probed."""
    email = body.email.lower()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if user:
        recent = await db.password_resets.find_one({"email": email})
        now = datetime.now(timezone.utc)
        if recent:
            sent = recent["created_at"]
            if sent.tzinfo is None:
                sent = sent.replace(tzinfo=timezone.utc)
            if (now - sent).total_seconds() < 60:
                return {"ok": True}
        code = f"{secrets.randbelow(1000000):06d}"
        await db.password_resets.delete_many({"email": email})
        await db.password_resets.insert_one({"email": email, "code_hash": bcrypt.hashpw(code.encode(), bcrypt.gensalt()).decode(),
                                             "attempts": 0, "created_at": now, "expires_at": now + timedelta(minutes=15)})
        subject, html = reset_email(body.lang, code)
        await send_email(to=email, subject=subject, html=html)
    return {"ok": True}


@api_router.post("/auth/reset")
async def reset_password(body: ResetIn):
    email = body.email.lower()
    r = await db.password_resets.find_one({"email": email})
    if not r:
        raise HTTPException(status_code=400, detail="invalid_code")
    exp = r["expires_at"] if r["expires_at"].tzinfo else r["expires_at"].replace(tzinfo=timezone.utc)
    if exp < datetime.now(timezone.utc) or r["attempts"] >= 5:
        await db.password_resets.delete_many({"email": email})
        raise HTTPException(status_code=400, detail="code_expired")
    if not bcrypt.checkpw(body.code.encode(), r["code_hash"].encode()):
        await db.password_resets.update_one({"_id": r["_id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=400, detail="invalid_code")
    await db.password_resets.delete_many({"email": email})
    await db.users.update_one({"email": email}, {"$set": {"password_hash": bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()},
                                                 "$addToSet": {"auth_methods": "password"}})
    user = await db.users.find_one({"email": email}, {"_id": 0})
    return {"token": make_jwt(user["user_id"]), "user": public_user(user)}


@api_router.get("/reminders")
async def reminders(authorization: Optional[str] = Header(None)):
    """Future reminder dates: vaccine boosters and next bath/grooming (date + remind_days)."""
    o = await auth_user_id(authorization)
    pets = {str(p["_id"]): p["name"] for p in await db.pets.find({"owner_id": o}).to_list(200)}
    out = []
    async for d in db.records.find({"owner_id": o, "type": {"$in": ["vaccine", "grooming"]}}):
        if d["pet_id"] not in pets:
            continue
        data = d.get("data", {})
        if d["type"] == "vaccine" and data.get("next_date"):
            when = data["next_date"]
        elif d["type"] == "grooming" and data.get("remind_days"):
            try:
                when = (date.fromisoformat(d["date"][:10]) + timedelta(days=int(data["remind_days"]))).isoformat()
            except (ValueError, TypeError):
                continue
        else:
            continue
        if when >= date.today().isoformat():
            out.append({"id": str(d["_id"]), "type": d["type"], "pet_name": pets[d["pet_id"]],
                        "name": data.get("name") or data.get("kind") or "", "date": when})
    out.sort(key=lambda x: x["date"])
    return out[:60]


# ---- Pets ----
@api_router.get("/pets")
async def list_pets(authorization: Optional[str] = Header(None)):
    o = await auth_user_id(authorization)
    docs = await db.pets.find({"owner_id": o}).sort("created_at", 1).to_list(200)
    result = []
    for d in docs:
        p = Pet.from_mongo(d).out()
        last_w = await db.records.find_one({"pet_id": p["id"], "type": "weight"}, sort=[("date", -1)])
        p["last_weight"] = (last_w or {}).get("data", {}).get("weight")
        result.append(p)
    return result


@api_router.post("/pets")
async def create_pet(body: PetIn, authorization: Optional[str] = Header(None)):
    o = await auth_user_id(authorization)
    pet = Pet(**body.model_dump(), owner_id=o, created_at=datetime.now(timezone.utc).isoformat())
    res = await db.pets.insert_one(pet.to_mongo())
    pet.id = str(res.inserted_id)
    return pet.out()


@api_router.get("/pets/{pet_id}")
async def get_pet(pet_id: str, authorization: Optional[str] = Header(None)):
    o = await auth_user_id(authorization)
    p = Pet.from_mongo(await get_pet_doc(pet_id, o)).out()
    counts = {}
    for t in ["vaccine", "weight", "illness", "medication", "visit", "exam", "grooming"]:
        counts[t] = await db.records.count_documents({"pet_id": pet_id, "type": t})
    last_w = await db.records.find_one({"pet_id": pet_id, "type": "weight"}, sort=[("date", -1)])
    vaccines = await db.records.find({"pet_id": pet_id, "type": "vaccine"}).to_list(500)
    nexts = sorted([v["data"].get("next_date") for v in vaccines if v.get("data", {}).get("next_date")])
    future = [n for n in nexts if n >= date.today().isoformat()]
    p["counts"] = counts
    p["last_weight"] = (last_w or {}).get("data", {}).get("weight")
    p["next_vaccine"] = future[0] if future else None
    p["overdue_vaccines"] = len([n for n in nexts if n < date.today().isoformat()])
    return p


@api_router.put("/pets/{pet_id}")
async def update_pet(pet_id: str, body: PetIn, authorization: Optional[str] = Header(None)):
    o = await auth_user_id(authorization)
    await get_pet_doc(pet_id, o)
    await db.pets.update_one({"_id": oid(pet_id)}, {"$set": body.model_dump()})
    return Pet.from_mongo(await get_pet_doc(pet_id, o)).out()


@api_router.delete("/pets/{pet_id}")
async def delete_pet(pet_id: str, authorization: Optional[str] = Header(None)):
    o = await auth_user_id(authorization)
    await get_pet_doc(pet_id, o)
    await db.pets.delete_one({"_id": oid(pet_id)})
    await db.records.delete_many({"pet_id": pet_id})
    return {"ok": True}


# ---- Records ----
@api_router.get("/pets/{pet_id}/records")
async def list_records(pet_id: str, type: Optional[RecordType] = None, authorization: Optional[str] = Header(None)):
    o = await auth_user_id(authorization)
    await get_pet_doc(pet_id, o)
    q: dict = {"pet_id": pet_id}
    if type:
        q["type"] = type
    docs = await db.records.find(q).sort("date", -1).to_list(1000)
    return [Record.from_mongo(d).out() for d in docs]


@api_router.post("/pets/{pet_id}/records")
async def create_record(pet_id: str, body: RecordIn, authorization: Optional[str] = Header(None)):
    o = await auth_user_id(authorization)
    await get_pet_doc(pet_id, o)
    rec = Record(**body.model_dump(), pet_id=pet_id, owner_id=o, created_at=datetime.now(timezone.utc).isoformat())
    res = await db.records.insert_one(rec.to_mongo())
    rec.id = str(res.inserted_id)
    return rec.out()


@api_router.get("/records/{record_id}")
async def get_record(record_id: str, authorization: Optional[str] = Header(None)):
    o = await auth_user_id(authorization)
    doc = await db.records.find_one({"_id": oid(record_id), "owner_id": o})
    if not doc:
        raise HTTPException(status_code=404, detail="Registro não encontrado")
    return Record.from_mongo(doc).out()


@api_router.put("/records/{record_id}")
async def update_record(record_id: str, body: RecordIn, authorization: Optional[str] = Header(None)):
    o = await auth_user_id(authorization)
    res = await db.records.update_one({"_id": oid(record_id), "owner_id": o}, {"$set": body.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Registro não encontrado")
    return Record.from_mongo(await db.records.find_one({"_id": oid(record_id)})).out()


@api_router.delete("/records/{record_id}")
async def delete_record(record_id: str, authorization: Optional[str] = Header(None)):
    o = await auth_user_id(authorization)
    res = await db.records.delete_one({"_id": oid(record_id), "owner_id": o})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Registro não encontrado")
    return {"ok": True}


@api_router.get("/upcoming")
async def upcoming(authorization: Optional[str] = Header(None)):
    """Vaccines with a next dose date (overdue or within 90 days) across all pets."""
    o = await auth_user_id(authorization)
    pets = {str(p["_id"]): p["name"] for p in await db.pets.find({"owner_id": o}).to_list(200)}
    limit = (date.today() + timedelta(days=90)).isoformat()
    docs = await db.records.find({"owner_id": o, "type": "vaccine", "data.next_date": {"$nin": [None, ""], "$lte": limit}}).to_list(500)
    items = []
    for d in docs:
        if d["pet_id"] not in pets:
            continue
        items.append({"record_id": str(d["_id"]), "pet_id": d["pet_id"], "pet_name": pets[d["pet_id"]],
                      "name": d["data"].get("name", "Vacina"), "next_date": d["data"]["next_date"]})
    items.sort(key=lambda x: x["next_date"])
    return items


# ---- Files ----
@api_router.post("/upload")
async def upload(file: UploadFile = File(...), authorization: Optional[str] = Header(None)):
    o = await auth_user_id(authorization)
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="file_too_large")
    ext = (file.filename or "foto.jpg").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "jpg"
    path = f"{APP_NAME}/uploads/{o}/{uuid.uuid4()}.{ext}"
    ctype = file.content_type or "image/jpeg"
    try:
        result = await run_in_threadpool(put_object, path, data, ctype)
    except requests.HTTPError as e:
        code = e.response.status_code if e.response is not None else 500
        if code == 402:
            raise HTTPException(status_code=402, detail="no_storage_credits")
        raise HTTPException(status_code=502, detail="upload_failed")
    await db.files.insert_one({"storage_path": result["path"], "owner_id": o, "content_type": ctype,
                               "original_filename": file.filename, "size": len(data),
                               "created_at": datetime.now(timezone.utc).isoformat()})
    return {"path": result["path"]}


async def read_file(path: str, o: str):
    rec = await db.files.find_one({"storage_path": path, "owner_id": o})
    if not rec:
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")
    data, ctype = await run_in_threadpool(get_object, path)
    return data, rec.get("content_type") or ctype


@api_router.get("/files/{path:path}")
async def download(path: str, t: Optional[str] = Query(None), authorization: Optional[str] = Header(None)):
    o = await auth_user_id(authorization, t)
    data, ctype = await read_file(path, o)
    return Response(content=data, media_type=ctype, headers={"Cache-Control": "private, max-age=86400"})


# ---- Report data (HTML is built on the device in the user's language) ----
@api_router.get("/pets/{pet_id}/report-data")
async def report_data(pet_id: str, sections: Optional[str] = None, authorization: Optional[str] = Header(None)):
    o = await auth_user_id(authorization)
    pet = await get_pet_doc(pet_id, o)
    wanted = sections.split(",") if sections else None
    q: dict = {"pet_id": pet_id}
    if wanted:
        q["type"] = {"$in": wanted}
    recs = [Record.from_mongo(d).out() for d in await db.records.find(q).sort("date", -1).to_list(2000)]

    images: Dict[str, str] = {}

    async def embed(path: str):
        if path in images:
            return
        try:
            data, ctype = await read_file(path, o)
            images[path] = f"data:{ctype};base64,{base64.b64encode(data).decode()}"
        except Exception as ex:  # noqa: BLE001
            logger.warning("report image failed %s: %s", path, ex)

    if pet.get("photo"):
        await embed(pet["photo"])
    for r in recs:
        for p in r.get("photos", [])[:6]:
            await embed(p)
    return {"pet": Pet.from_mongo(pet).out(), "records": recs, "images": images}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    try:
        init_storage()
        logger.info("Storage initialized")
    except Exception as ex:  # noqa: BLE001
        logger.error("Storage init failed: %s", ex)
    await db.pets.create_index("owner_id")
    await db.records.create_index([("pet_id", 1), ("type", 1), ("date", -1)])
    await db.files.create_index("storage_path")
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.revoked_tokens.create_index("expires_at", expireAfterSeconds=0)
    await db.password_resets.create_index("expires_at", expireAfterSeconds=0)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
