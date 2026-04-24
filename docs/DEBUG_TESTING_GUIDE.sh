#!/usr/bin/env bash

# ConsumerShield Debug Testing Guide
# Test tracker detection and AI insight on Flipkart

echo "=========================================="
echo "ConsumerShield Debug Testing"
echo "=========================================="
echo ""

# Step 1: Confirm backend is running
echo "[Step 1] Verifying backend is running..."
HEALTH=$(curl -s http://localhost:8000/health | grep -o '"gemini_enabled":[^,]*')
if [[ $HEALTH == *"true"* ]]; then
    echo "✅ Backend running with Gemini enabled"
else
    echo "❌ Backend not responding or Gemini disabled"
    echo "   Run: cd /home/kart/Desktop/hackathon/ConsumerShield-Backup-/consumershield/backend"
    echo "        /home/kart/Desktop/hackathon/.venv/bin/uvicorn main:app --reload --port 8000"
    exit 1
fi
echo ""

# Step 2: Instructions for testing
cat << 'EOF'
[Step 2] Manual Testing Steps:

1. RELOAD EXTENSION
   → Go to chrome://extensions/
   → Find ConsumerShield
   → Click the REFRESH button
   
2. OPEN FLIPKART
   → Navigate to https://www.flipkart.com
   → Wait 5 seconds for page to load and extension to run

3. CHECK CONTENT SCRIPT LOGS
   → Press F12 (Developer Tools)
   → Go to Console tab
   → Look for logs starting with "[ConsumerShield]"
   
   Expected logs:
   - "[ConsumerShield] Trackers found: [...]" 
     Should show array with 2+ tracker objects
   - If empty array: trackers not being detected

4. OPEN POPUP & CHECK POPUP LOGS
   → Right-click the ConsumerShield icon
   → Select "Inspect popup"
   → Go to Console tab in the DevTools that opens
   
   Expected logs:
   - "[ConsumerShield] Calling backend..."
   - "[ConsumerShield] URL: https://www.flipkart.com"
   - "[ConsumerShield] Trackers: [...]"
   - "[ConsumerShield] Patterns: [...]"
   - "[ConsumerShield] AI response: {...}"
   - "[ConsumerShield] AI insight: ..."
   
   If you see "[ConsumerShield] Backend error: ..."
   → Check if backend is running
   → Check if endpoint URL is correct

5. VERIFY POPUP DISPLAY
   → In the popup, check Overview tab
   → Should show:
     ✓ Privacy Risk score
     ✓ Manipulation Risk score
     ✓ Overall Risk score
     ✓ Number of trackers detected (should be 2+)
     ✓ Number of dark patterns detected
     ✓ 🤖 AI Insight box with Gemini response

COMMON ISSUES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Issue: "Trackers (0)" showing in popup
Fix: Check console for "[ConsumerShield] Trackers found: [...]"
     If array is empty, tracker detection failed
     → Likely causes:
        • CSS selector error fixed (ba99179 commit)
        • state.trackers not being populated
        • detectTrackers() not being called
        
Issue: No AI insight appearing
Fixes: Check popup console for "[ConsumerShield] Backend error"
       → Ensure backend running: curl http://localhost:8000/health
       → Ensure localhost in host_permissions (manifest.json updated)
       → Check fetch URL is exactly "http://localhost:8000/analyze-complete"
       
Issue: Popup won't load at all
Fix: Right-click extension → "Inspect popup"
     Check browser console for any errors
     Reload extension fresh from chrome://extensions/

DEBUGGING COMMANDS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Check backend health:
  curl -s http://localhost:8000/health | jq .

Check backend logs:
  tail -f /tmp/uvicorn.log

Restart backend:
  pkill -f uvicorn
  sleep 1
  cd /home/kart/Desktop/hackathon/ConsumerShield-Backup-/consumershield/backend
  /home/kart/Desktop/hackathon/.venv/bin/uvicorn main:app --reload --port 8000

EOF

echo ""
echo "=========================================="
echo "Changes Made:"
echo "=========================================="
echo "✓ Added console.log in content.js (line 368)"
echo "✓ Added console.log in popup.js (lines 70-73, 92)"
echo "✓ Added localhost to manifest.json host_permissions"
echo ""
echo "Commit: 2e8a24e"
echo ""
