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
import requests
from pathlib import Path
from pydantic import BaseModel, Field, BeforeValidator, ConfigDict
from typing import Annotated, Any, Dict, List, Literal, Optional
from datetime import datetime, timezone, date, timedelta

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

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


RecordType = Literal["vaccine", "weight", "illness", "medication", "visit", "exam"]


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


def owner(x_device_id: Optional[str]) -> str:
    if not x_device_id or len(x_device_id) < 16:
        raise HTTPException(status_code=401, detail="Dispositivo não identificado")
    return x_device_id


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


# ---- Pets ----
@api_router.get("/pets")
async def list_pets(x_device_id: Optional[str] = Header(None)):
    o = owner(x_device_id)
    docs = await db.pets.find({"owner_id": o}).sort("created_at", 1).to_list(200)
    result = []
    for d in docs:
        p = Pet.from_mongo(d).out()
        last_w = await db.records.find_one({"pet_id": p["id"], "type": "weight"}, sort=[("date", -1)])
        p["last_weight"] = (last_w or {}).get("data", {}).get("weight")
        result.append(p)
    return result


@api_router.post("/pets")
async def create_pet(body: PetIn, x_device_id: Optional[str] = Header(None)):
    o = owner(x_device_id)
    pet = Pet(**body.model_dump(), owner_id=o, created_at=datetime.now(timezone.utc).isoformat())
    res = await db.pets.insert_one(pet.to_mongo())
    pet.id = str(res.inserted_id)
    return pet.out()


@api_router.get("/pets/{pet_id}")
async def get_pet(pet_id: str, x_device_id: Optional[str] = Header(None)):
    o = owner(x_device_id)
    p = Pet.from_mongo(await get_pet_doc(pet_id, o)).out()
    counts = {}
    for t in ["vaccine", "weight", "illness", "medication", "visit", "exam"]:
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
async def update_pet(pet_id: str, body: PetIn, x_device_id: Optional[str] = Header(None)):
    o = owner(x_device_id)
    await get_pet_doc(pet_id, o)
    await db.pets.update_one({"_id": oid(pet_id)}, {"$set": body.model_dump()})
    return Pet.from_mongo(await get_pet_doc(pet_id, o)).out()


@api_router.delete("/pets/{pet_id}")
async def delete_pet(pet_id: str, x_device_id: Optional[str] = Header(None)):
    o = owner(x_device_id)
    await get_pet_doc(pet_id, o)
    await db.pets.delete_one({"_id": oid(pet_id)})
    await db.records.delete_many({"pet_id": pet_id})
    return {"ok": True}


# ---- Records ----
@api_router.get("/pets/{pet_id}/records")
async def list_records(pet_id: str, type: Optional[RecordType] = None, x_device_id: Optional[str] = Header(None)):
    o = owner(x_device_id)
    await get_pet_doc(pet_id, o)
    q: dict = {"pet_id": pet_id}
    if type:
        q["type"] = type
    docs = await db.records.find(q).sort("date", -1).to_list(1000)
    return [Record.from_mongo(d).out() for d in docs]


@api_router.post("/pets/{pet_id}/records")
async def create_record(pet_id: str, body: RecordIn, x_device_id: Optional[str] = Header(None)):
    o = owner(x_device_id)
    await get_pet_doc(pet_id, o)
    rec = Record(**body.model_dump(), pet_id=pet_id, owner_id=o, created_at=datetime.now(timezone.utc).isoformat())
    res = await db.records.insert_one(rec.to_mongo())
    rec.id = str(res.inserted_id)
    return rec.out()


@api_router.get("/records/{record_id}")
async def get_record(record_id: str, x_device_id: Optional[str] = Header(None)):
    o = owner(x_device_id)
    doc = await db.records.find_one({"_id": oid(record_id), "owner_id": o})
    if not doc:
        raise HTTPException(status_code=404, detail="Registro não encontrado")
    return Record.from_mongo(doc).out()


@api_router.put("/records/{record_id}")
async def update_record(record_id: str, body: RecordIn, x_device_id: Optional[str] = Header(None)):
    o = owner(x_device_id)
    res = await db.records.update_one({"_id": oid(record_id), "owner_id": o}, {"$set": body.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Registro não encontrado")
    return Record.from_mongo(await db.records.find_one({"_id": oid(record_id)})).out()


@api_router.delete("/records/{record_id}")
async def delete_record(record_id: str, x_device_id: Optional[str] = Header(None)):
    o = owner(x_device_id)
    res = await db.records.delete_one({"_id": oid(record_id), "owner_id": o})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Registro não encontrado")
    return {"ok": True}


@api_router.get("/upcoming")
async def upcoming(x_device_id: Optional[str] = Header(None)):
    """Vaccines with a next dose date (overdue or within 90 days) across all pets."""
    o = owner(x_device_id)
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
async def upload(file: UploadFile = File(...), x_device_id: Optional[str] = Header(None)):
    o = owner(x_device_id)
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
async def download(path: str, d: Optional[str] = Query(None), x_device_id: Optional[str] = Header(None)):
    o = owner(x_device_id or d)
    data, ctype = await read_file(path, o)
    return Response(content=data, media_type=ctype, headers={"Cache-Control": "private, max-age=86400"})


# ---- Report data (HTML is built on the device in the user's language) ----
@api_router.get("/pets/{pet_id}/report-data")
async def report_data(pet_id: str, sections: Optional[str] = None, x_device_id: Optional[str] = Header(None)):
    o = owner(x_device_id)
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


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
