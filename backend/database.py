"""
ConsumerShield database utilities.

Stores analysis reports for fast UI loading, while blockchain anchoring can
complete asynchronously and update each record's integrity status.
"""

import json
import os
from datetime import datetime
from typing import Any, Dict, Generator, List

from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String, Text, create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE_PATH = os.path.join(BACKEND_DIR, "consumershield.db")
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DB_FILE_PATH}")

_MIGRATION_COMPLETED = False

# SQLite needs check_same_thread=False when using FastAPI request/session pattern.
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)


if DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()


class Base(DeclarativeBase):
    pass


class ReportRecord(Base):
    __tablename__ = "reports"

    id = Column(Integer, primary_key=True, autoincrement=True)
    report_id = Column(String(36), unique=True, nullable=False, index=True)
    url = Column(Text, nullable=False)
    domain = Column(String(255), nullable=False, index=True)

    # Primary report ledger fields (single source of truth)
    risk_score = Column(Float, nullable=False, default=0.0, index=True)
    detected_patterns = Column(Text, nullable=False, default="[]")
    details = Column(Text, nullable=True)
    timestamp = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    blockchain_proof = Column(Boolean, nullable=False, default=False, index=True)
    blockchain_tx_hash = Column(String(100), nullable=True, index=True)

    report_hash = Column(String(100), nullable=False, index=True)
    canonical_payload = Column(Text, nullable=False)

    tx_hash = Column(String(80), nullable=True, index=True)
    anchor_status = Column(String(24), nullable=False, default="pending", index=True)
    anchor_error = Column(Text, nullable=True)
    verification_status = Column(String(24), nullable=False, default="not_verified", index=True)
    verification_error = Column(Text, nullable=True)
    verified_at = Column(DateTime, nullable=True)

    privacy_risk = Column(Float, nullable=False, default=0.0)
    manipulation_risk = Column(Float, nullable=False, default=0.0)
    overall_risk = Column(Float, nullable=False, default=0.0)

    pattern_count = Column(Integer, nullable=False, default=0)
    tracker_count = Column(Integer, nullable=False, default=0)
    pattern_names_json = Column(Text, nullable=False, default="[]")

    combined_insight = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)


def init_db() -> None:
    global _MIGRATION_COMPLETED
    Base.metadata.create_all(bind=engine)
    _ensure_reports_columns()
    if not _MIGRATION_COMPLETED:
        _backfill_reports_defaults()
        _MIGRATION_COMPLETED = True


def _ensure_reports_columns() -> None:
    """Best-effort migration for environments with pre-existing reports table."""
    required_columns = {
        "risk_score": "FLOAT DEFAULT 0.0",
        "detected_patterns": "TEXT DEFAULT '[]'",
        "details": "TEXT",
        "timestamp": "DATETIME",
        "blockchain_proof": "BOOLEAN DEFAULT 0",
        "blockchain_tx_hash": "TEXT",
        "verification_status": "TEXT DEFAULT 'not_verified'",
        "verification_error": "TEXT",
        "verified_at": "DATETIME",
    }

    with engine.begin() as conn:
        try:
            rows = conn.execute(text("PRAGMA table_info(reports)")).fetchall()
        except Exception:
            return

        existing = {str(row[1]) for row in rows}
        for column_name, ddl in required_columns.items():
            if column_name in existing:
                continue
            conn.execute(text(f"ALTER TABLE reports ADD COLUMN {column_name} {ddl}"))


def _backfill_reports_defaults() -> None:
    with engine.begin() as conn:
        conn.execute(text(
            "UPDATE reports "
            "SET risk_score = COALESCE(risk_score, overall_risk, 0.0)"
        ))
        conn.execute(text(
            "UPDATE reports "
            "SET detected_patterns = COALESCE(NULLIF(detected_patterns, ''), pattern_names_json, '[]')"
        ))
        conn.execute(text(
            "UPDATE reports "
            "SET details = COALESCE(NULLIF(details, ''), combined_insight, '')"
        ))
        conn.execute(text(
            "UPDATE reports "
            "SET timestamp = COALESCE(timestamp, created_at, CURRENT_TIMESTAMP)"
        ))
        conn.execute(text(
            "UPDATE reports "
            "SET blockchain_tx_hash = COALESCE(NULLIF(blockchain_tx_hash, ''), tx_hash)"
        ))
        conn.execute(text(
            "UPDATE reports "
            "SET blockchain_proof = CASE "
            "  WHEN COALESCE(NULLIF(blockchain_tx_hash, ''), NULLIF(tx_hash, '')) IS NOT NULL THEN 1 "
            "  ELSE COALESCE(blockchain_proof, 0) "
            "END"
        ))
        conn.execute(text(
            "UPDATE reports "
            "SET verification_status = CASE "
            "  WHEN COALESCE(NULLIF(verification_status, ''), '') <> '' THEN verification_status "
            "  WHEN anchor_status = 'anchored' THEN 'pending' "
            "  WHEN anchor_status = 'not_required' THEN 'not_required' "
            "  WHEN anchor_status = 'not_requested' THEN 'not_requested' "
            "  ELSE 'not_verified' "
            "END"
        ))


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def clear_reports_table() -> int:
    """Delete all persisted reports and return how many rows were removed."""
    db = SessionLocal()
    try:
        deleted_count = db.query(ReportRecord).delete(synchronize_session=False)
        db.commit()
        return int(deleted_count or 0)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def build_canonical_payload(
    *,
    url: str,
    domain: str,
    privacy_risk: float,
    manipulation_risk: float,
    overall_risk: float,
    tracker_count: int,
    pattern_names: List[str],
    combined_insight: str,
) -> Dict[str, Any]:
    """Create the exact payload shape used for deterministic hashing."""
    normalized_names = sorted({str(name).strip() for name in pattern_names if str(name).strip()})

    return {
        "url": str(url or "").strip(),
        "domain": str(domain or "").strip().lower(),
        "privacy_risk": round(float(privacy_risk or 0.0), 3),
        "manipulation_risk": round(float(manipulation_risk or 0.0), 3),
        "overall_risk": round(float(overall_risk or 0.0), 3),
        "tracker_count": int(tracker_count or 0),
        "pattern_names": normalized_names,
        "combined_insight": str(combined_insight or "").strip(),
    }


def canonical_payload_to_json(payload: Dict[str, Any]) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)


def encode_pattern_names(pattern_names: List[str]) -> str:
    normalized = [str(name).strip() for name in pattern_names if str(name).strip()]
    return json.dumps(sorted(set(normalized)), separators=(",", ":"))


def decode_pattern_names(raw: str) -> List[str]:
    try:
        parsed = json.loads(raw or "[]")
        if isinstance(parsed, list):
            return [str(item) for item in parsed]
    except Exception:
        pass
    return []


def encode_detected_patterns(detected_patterns: List[str]) -> str:
    return encode_pattern_names(detected_patterns)


def decode_detected_patterns(raw: str) -> List[str]:
    return decode_pattern_names(raw)
