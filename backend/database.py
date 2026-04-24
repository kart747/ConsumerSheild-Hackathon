"""
ConsumerShield database utilities.

Stores analysis reports for fast UI loading, while blockchain anchoring can
complete asynchronously and update each record's integrity status.
"""

import os
import uuid
from datetime import datetime
from typing import Any, Dict, Generator, List

from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String, Text, create_engine
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable is required")

engine = create_engine(
    DATABASE_URL,
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True
)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class ReportRecord(Base):
    __tablename__ = "reports"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    url = Column(Text, nullable=False)
    domain = Column(String(255), nullable=False, index=True)

    risk_score = Column(Float, nullable=False, default=0.0, index=True)
    detected_patterns = Column(JSONB, nullable=False, default=lambda: [])
    details = Column(JSONB, nullable=True)
    timestamp = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    blockchain_proof = Column(Boolean, nullable=False, default=False, index=True)
    blockchain_tx_hash = Column(String(100), nullable=True, index=True)

    report_hash = Column(String(100), nullable=False, index=True)
    canonical_payload = Column(JSONB, nullable=False)

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
    pattern_names_json = Column(JSONB, nullable=False, default=lambda: [])

    combined_insight = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)


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


import json

def canonical_payload_to_json(payload: Dict[str, Any]) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def encode_pattern_names(pattern_names: List[str]) -> List[str]:
    return sorted({str(name).strip() for name in pattern_names if str(name).strip()})


def decode_pattern_names(raw: List[str]) -> List[str]:
    if isinstance(raw, list):
        return [str(item) for item in raw]
    return []


def encode_detected_patterns(detected_patterns: List[str]) -> List[str]:
    return encode_pattern_names(detected_patterns)


def decode_detected_patterns(raw: List[str]) -> List[str]:
    return decode_pattern_names(raw)