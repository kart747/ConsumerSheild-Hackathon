source venv/bin/activate
uvicorn main:app --port 8000 > server.log 2>&1 &
PID=$!
sleep 2
python test_api.py
kill $PID
