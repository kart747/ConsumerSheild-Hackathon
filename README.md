# ConsumerShield - Repository Structure

This repository contains a browser extension (`extension/`) and backend service (`backend/`) for detecting and preventing dark patterns and privacy violations online.

## 📁 Repository Organization

```
consumershield/
├── backend/                    # FastAPI backend server
│   ├── main.py                # Entry point for the API server
│   ├── database.py            # Database models and queries
│   ├── regulatory_database.py # Regulatory data management
│   ├── ethereum_anchor.py     # Blockchain evidence anchoring
│   ├── requirements.txt       # Python dependencies
│   ├── consumershield.db      # SQLite database (generated at runtime)
│   └── .env                   # Environment variables (not in repo)
│
├── extension/                  # Chrome/Chromium browser extension
│   ├── manifest.json          # Extension configuration
│   ├── background.js          # Service worker for extension
│   ├── content.js             # Content script for page analysis
│   ├── popup.html/js/css      # Extension popup UI
│   ├── report.html/js         # Detailed risk report
│   ├── dual-risk-calculator.js# Risk scoring engine
│   └── icons/                 # Extension icons
│
├── docs/                       # Documentation and guides
│   ├── README.md              # Project overview
│   ├── TESTING_CHECKLIST.md   # Test cases and verification
│   ├── BEFORE_AFTER_COMPARISON.md
│   └── *.md                   # Other documentation
│
├── tests/                      # Test scripts
│   ├── test_api.py            # API endpoint tests
│   ├── test_gemini_direct.py  # AI model tests
│   ├── run_test.sh            # Test runner script
│   └── *.py                   # Other test files
│
├── .venv/                      # Python virtual environment
├── .vscode/                    # VS Code workspace settings
├── .gitignore                  # Git ignore rules
└── README.md                   # This file
```

## 🚀 Quick Start

### Backend Setup

```bash
# Create and activate virtual environment
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
cd backend
pip install -r requirements.txt

# Configure environment
cp .env.example .env  # Create from template (if exists)
# Edit .env with your credentials:
# - OPENAI_API_KEY (optional, for AI insights)
# - RPC_URL (optional, for blockchain anchoring)
# - PRIVATE_KEY (optional, for blockchain anchoring)

# Start backend server
uvicorn main:app --reload --port 8000
# API docs: http://localhost:8000/docs
```

### Extension Setup

1. Open Chrome → go to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder
5. The 🛡️ ConsumerShield icon appears in your toolbar

## 🧪 Testing

Run tests from the project root:

```bash
# Run backend tests
bash tests/run_test.sh

# Run API tests
python tests/test_api.py

# Run AI model tests
python tests/test_gemini_direct.py

# Run extension tests
python tests/test_extension.py
```

## 📋 Key Features

- ✅ Detects dark patterns (trick questions, disguised ads, sneaking, forced actions, etc.)
- ✅ Tracks privacy violations and regulatory compliance
- ✅ Real-time risk scoring and reporting
- ✅ Blockchain evidence anchoring (optional)
- ✅ Works fully offline (backend optional for AI insights)
- ✅ Enforces: DPDP Act 2023, CCPA Guidelines 2023, Consumer Protection Act 2019

## 📚 Documentation

See the `docs/` folder for:
- `README.md` - Project overview and detailed features
- `TESTING_CHECKLIST.md` - Test cases and verification procedures
- Migration and analysis documents

## ⚙️ Dependencies

**Backend:**
- FastAPI (Python web framework)
- SQLite (database)
- Python 3.8+

**Extension:**
- Chrome/Chromium browser (Manifest v3)
- JavaScript (ES6+)

## 🔐 Environment Variables

Create a `.env` file in the `backend/` folder:

```env
# AI Integration (optional)
OPENAI_API_KEY=your_openai_key

# Blockchain Anchoring (optional)
RPC_URL=https://sepolia.infura.io/v3/YOUR_PROJECT_ID
CONTRACT_ADDRESS=0x...
PRIVATE_KEY=0x...
ETH_CHAIN_ID=11155111
ETH_RECEIPT_TIMEOUT_SEC=180
```

## 🛠️ Development

- **Backend**: Python 3.8+, FastAPI
- **Frontend**: Vanilla JavaScript (Manifest v3)
- **Database**: SQLite
- **Testing**: pytest, pytest-asyncio

For detailed development information, see `docs/README.md`.

## 📝 License

See repository LICENSE file for details.

## 🤝 Contributing

1. Create a feature branch
2. Make your changes
3. Run tests to verify
4. Submit a pull request

---

**Last Updated**: April 23, 2026
