"""
Ethereum anchoring utilities for ConsumerShield evidence records.

This module stores a deterministic bytes32 keccak hash of a report payload in
the EvidenceRegistry contract on Sepolia, so the backend can return an
immutable proof transaction.
"""

import json
import hashlib
import logging
import os
from typing import Any, Dict

from web3 import Web3
from web3.exceptions import ContractLogicError, TransactionNotFound

logger = logging.getLogger("consumershield.ethereum")

SEPOLIA_CHAIN_ID = 11155111

# Minimal ABI variants for EvidenceRegistry deployments.
EVIDENCE_REGISTRY_ABI = [
    {
        "inputs": [{"internalType": "bytes32", "name": "reportHash", "type": "bytes32"}],
        "name": "storeHash",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [{"internalType": "string", "name": "hash", "type": "string"}],
        "name": "storeHash",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
]

ABI = EVIDENCE_REGISTRY_ABI


class BlockchainAnchoringError(Exception):
    """Raised when report anchoring on Ethereum fails."""


class DuplicateReportAnchoringError(BlockchainAnchoringError):
    """Raised when the contract rejects a report hash as already stored."""


def build_report_sha256(report_data: Dict[str, Any]) -> str:
    """Create a deterministic SHA256 hash from report JSON."""
    report_json = json.dumps(
        report_data,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(report_json.encode("utf-8")).hexdigest()


def build_report_keccak(report_data: Dict[str, Any]) -> str:
    """Create a deterministic EVM-compatible hex hash from sorted report JSON.

    The timestamp is excluded from hash computation so logically identical
    reports always map to the same hash regardless of when they were submitted.
    """
    stable_report = {k: v for k, v in report_data.items() if k != "timestamp"}
    report_json = json.dumps(stable_report, sort_keys=True, separators=(",", ":"), default=str)
    return Web3.keccak(text=report_json).hex()


def _is_duplicate_report_error(error: Exception) -> bool:
    error_str = str(error).lower()
    duplicate_indicators = [
        'report already stored',
        'already stored',
        'duplicate',
        'hash exists',
        'already exists',
        'entry exists',
    ]
    return any(indicator in error_str for indicator in duplicate_indicators)


def _first_available_env(*names: str) -> str:
    for name in names:
        value = os.getenv(name)
        if value and value.strip():
            return value.strip()
    raise BlockchainAnchoringError(
        "Missing required environment variable. Expected one of: " + ", ".join(names)
    )


def _store_hash_string_on_chain(report_hash: str) -> str:
    """Store a precomputed hash string in EvidenceRegistry and return tx hash."""
    rpc_url = _first_available_env("RPC_URL", "ETH_RPC_URL")
    contract_address = _first_available_env(
        "CONTRACT_ADDRESS",
        "EVIDENCE_REGISTRY_CONTRACT_ADDRESS",
    )
    private_key = _first_available_env("PRIVATE_KEY", "ETH_PRIVATE_KEY")

    chain_id = int(os.getenv("ETH_CHAIN_ID", str(SEPOLIA_CHAIN_ID)))
    receipt_timeout = int(os.getenv("ETH_RECEIPT_TIMEOUT_SEC", "180"))

    web3 = Web3(Web3.HTTPProvider(rpc_url))
    if not web3.is_connected():
        raise BlockchainAnchoringError("Unable to connect to Ethereum RPC endpoint")

    contract = web3.eth.contract(
        address=Web3.to_checksum_address(contract_address),
        abi=ABI,
    )

    account = web3.eth.account.from_key(private_key)
    wallet_address = account.address

    normalized_hash = str(report_hash or "").strip().lower().removeprefix("0x")
    if len(normalized_hash) != 64:
        raise BlockchainAnchoringError("Report hash must be a 32-byte hex value")
    hash_bytes = bytes.fromhex(normalized_hash)

    tx_calls = []
    # Prefer bytes32 ABI where available.
    try:
        tx_calls.append(contract.get_function_by_signature("storeHash(bytes32)")(hash_bytes))
    except Exception:
        pass
    # Fallback for deployments that still accept string payloads.
    try:
        tx_calls.append(contract.get_function_by_signature("storeHash(string)")("0x" + normalized_hash))
    except Exception:
        pass

    if not tx_calls:
        raise BlockchainAnchoringError("No compatible storeHash function found in contract ABI")

    last_error: Exception | None = None
    for tx_call in tx_calls:
        try:
            tx_call.call({"from": wallet_address})

            transaction = tx_call.build_transaction(
                {
                    "from": wallet_address,
                    "nonce": web3.eth.get_transaction_count(wallet_address),
                    "chainId": chain_id,
                    "gas": 200000,
                    "gasPrice": web3.eth.gas_price,
                }
            )

            signed_txn = web3.eth.account.sign_transaction(transaction, private_key=private_key)
            tx_hash = web3.eth.send_raw_transaction(signed_txn.raw_transaction)
            receipt = web3.eth.wait_for_transaction_receipt(tx_hash, timeout=receipt_timeout)

            if receipt.status != 1:
                raise BlockchainAnchoringError("Ethereum transaction reverted")

            tx_hash_hex = Web3.to_hex(tx_hash)
            logger.info("Blockchain proof stored successfully. tx_hash=%s", tx_hash_hex)
            return tx_hash_hex
        except ContractLogicError as exc:
            if _is_duplicate_report_error(exc):
                raise DuplicateReportAnchoringError(
                    "Duplicate report already anchored on blockchain"
                ) from exc
            last_error = exc
            continue
        except Exception as exc:
            if _is_duplicate_report_error(exc):
                raise DuplicateReportAnchoringError(
                    "Duplicate report already anchored on blockchain"
                ) from exc
            last_error = exc
            continue

    raise BlockchainAnchoringError(
        f"Smart contract rejected report hash: {last_error}"
    )


def store_report_hash_on_chain(report_data: dict) -> str:
    """
    Hash a report payload and store that hash in EvidenceRegistry on Ethereum.

    Returns the Ethereum transaction hash if successful.
    """
    try:
        report_hash = build_report_keccak(report_data)
        return _store_hash_string_on_chain(report_hash)
    except DuplicateReportAnchoringError:
        raise
    except BlockchainAnchoringError:
        raise
    except Exception as exc:
        if _is_duplicate_report_error(exc):
            raise DuplicateReportAnchoringError(
                "Duplicate report already anchored on blockchain"
            ) from exc
        raise BlockchainAnchoringError(f"Failed to store report hash on-chain: {exc}") from exc


def store_precomputed_hash_on_chain(report_hash: str) -> str:
    """Store caller-supplied hash directly in contract (no backend re-hashing)."""
    normalized_hash = str(report_hash or "").strip()
    if not normalized_hash:
        raise BlockchainAnchoringError("Cannot anchor empty report hash")

    try:
        return _store_hash_string_on_chain(normalized_hash)
    except DuplicateReportAnchoringError:
        raise
    except BlockchainAnchoringError:
        raise
    except Exception as exc:
        if _is_duplicate_report_error(exc):
            raise DuplicateReportAnchoringError(
                "Duplicate report already anchored on blockchain"
            ) from exc
        raise BlockchainAnchoringError(f"Failed to store precomputed hash on-chain: {exc}") from exc


def get_stored_hash_from_tx(tx_hash: str) -> str:
    """Decode storeHash calldata and return the hash string committed on-chain."""
    if not tx_hash or not str(tx_hash).strip():
        raise BlockchainAnchoringError("Missing transaction hash for verification")

    rpc_url = _first_available_env("RPC_URL", "ETH_RPC_URL")
    contract_address = _first_available_env(
        "CONTRACT_ADDRESS",
        "EVIDENCE_REGISTRY_CONTRACT_ADDRESS",
    )

    web3 = Web3(Web3.HTTPProvider(rpc_url))
    if not web3.is_connected():
        raise BlockchainAnchoringError("Unable to connect to Ethereum RPC endpoint")

    contract = web3.eth.contract(
        address=Web3.to_checksum_address(contract_address),
        abi=ABI,
    )

    try:
        tx = web3.eth.get_transaction(str(tx_hash).strip())
    except Exception as exc:
        raise BlockchainAnchoringError(f"Unable to fetch transaction {tx_hash}: {exc}") from exc

    input_data = tx.get("input") or ""
    if not input_data or input_data == "0x":
        raise BlockchainAnchoringError("Transaction input is empty; cannot decode stored hash")

    try:
        function_obj, params = contract.decode_function_input(input_data)
    except Exception as exc:
        raise BlockchainAnchoringError(f"Failed to decode transaction calldata: {exc}") from exc

    if getattr(function_obj, "fn_name", "") != "storeHash":
        raise BlockchainAnchoringError("Transaction is not a storeHash call")

    raw_hash = params.get("reportHash")
    if raw_hash is None:
        raw_hash = params.get("hash")

    if raw_hash is None:
        raise BlockchainAnchoringError("Decoded transaction does not contain a hash value")

    if isinstance(raw_hash, (bytes, bytearray)):
        return "0x" + bytes(raw_hash).hex()

    on_chain_hash = str(raw_hash).strip()
    if not on_chain_hash:
        raise BlockchainAnchoringError("Decoded transaction does not contain a hash value")
    if not on_chain_hash.startswith("0x"):
        on_chain_hash = "0x" + on_chain_hash.lower().removeprefix("0x")
    return on_chain_hash


def _normalize_hash(value: str) -> str:
    return str(value or "").strip().lower().removeprefix("0x")


def verify_report_hash_on_chain(tx_hash: str, expected_hash: str) -> Dict[str, Any]:
    """Cross-check DB hash against the hash committed in Ethereum tx calldata."""
    normalized_expected = _normalize_hash(expected_hash)
    if not normalized_expected:
        return {
            "verified": False,
            "on_chain_hash": None,
            "expected_hash": "",
            "error": "Missing expected hash for verification",
        }

    try:
        on_chain_hash = get_stored_hash_from_tx(tx_hash)
        normalized_on_chain = _normalize_hash(on_chain_hash)
        return {
            "verified": normalized_on_chain == normalized_expected,
            "on_chain_hash": on_chain_hash,
            "expected_hash": expected_hash,
            "error": None,
        }
    except Exception as exc:
        return {
            "verified": False,
            "on_chain_hash": None,
            "expected_hash": expected_hash,
            "error": str(exc),
        }


def inspect_transaction_state(tx_hash: str) -> Dict[str, Any]:
    """Inspect a transaction and classify state for anchor reconciliation."""
    normalized_tx_hash = str(tx_hash or "").strip()
    if not normalized_tx_hash:
        raise BlockchainAnchoringError("Missing transaction hash for state inspection")

    rpc_url = _first_available_env("RPC_URL", "ETH_RPC_URL")
    web3 = Web3(Web3.HTTPProvider(rpc_url))
    if not web3.is_connected():
        raise BlockchainAnchoringError("Unable to connect to Ethereum RPC endpoint")

    try:
        tx = web3.eth.get_transaction(normalized_tx_hash)
    except TransactionNotFound:
        return {
            "state": "dropped",
            "receipt_status": None,
            "tx_hash": normalized_tx_hash,
            "block_number": None,
            "error": "transaction_not_found",
        }
    except Exception as exc:
        raise BlockchainAnchoringError(f"Unable to fetch transaction {normalized_tx_hash}: {exc}") from exc

    try:
        receipt = web3.eth.get_transaction_receipt(normalized_tx_hash)
    except TransactionNotFound:
        return {
            "state": "pending",
            "receipt_status": None,
            "tx_hash": Web3.to_hex(tx.get("hash", normalized_tx_hash)),
            "block_number": None,
            "error": None,
        }
    except Exception as exc:
        raise BlockchainAnchoringError(
            f"Unable to fetch transaction receipt {normalized_tx_hash}: {exc}"
        ) from exc

    receipt_status_raw = receipt.get("status") if isinstance(receipt, dict) else getattr(receipt, "status", None)
    receipt_status = int(receipt_status_raw) if receipt_status_raw is not None else None

    if receipt_status == 1:
        state = "mined_success"
    elif receipt_status == 0:
        state = "mined_failed"
    else:
        state = "pending"

    block_number = receipt.get("blockNumber") if isinstance(receipt, dict) else getattr(receipt, "blockNumber", None)
    return {
        "state": state,
        "receipt_status": receipt_status,
        "tx_hash": Web3.to_hex(tx.get("hash", normalized_tx_hash)),
        "block_number": block_number,
        "error": None,
    }
