# 🚀 ConsumerShield Extension v2 — Testing Checklist

## Pre-Testing Verification
- [x] Extension file `/consumershield/extension/content.js` updated
- [x] All 8 dark pattern categories expanded with 60+ patterns
- [x] 4 new DOM detection functions added
- [x] No JavaScript syntax errors (verified with `node -c`)
- [x] All changes committed to git
- [x] Repository pushed to GitHub (https://github.com/kart747/ConsumerSheild)

---

## Reload Extension in Chrome

### Option 1: Developer Mode Reload (Fast)
```
1. Go to chrome://extensions/
2. Enable "Developer mode" (top right toggle)
3. Find ConsumerShield extension
4. Click the refresh icon (↻)
5. Wait 2 seconds for reload
6. Extension icon should not show red "error" badge
```

### Option 2: Full Remove + Re-add (Thorough)
```
1. Go to chrome://extensions/
2. Scroll to ConsumerShield
3. Click "Remove"
4. Click "Add unpacked" 
5. Navigate to: /home/kart/Desktop/hackathon/ConsumerShield-Backup-/consumershield/extension
6. Select folder and click "Open"
7. Extension should appear in the list
```

---

## Test Sites & Expected Results

### Test 1: Flipkart (https://www.flipkart.com)
**Expected Detections:** 5+ patterns with red borders

#### Pattern 1: False Urgency
- [ ] Red border around "Offers Available Today" text
- [ ] Red border around "X left in stock" text
- [ ] Red border around "X people viewing" text

#### Pattern 2: Misdirection
- [ ] Red border around "Recommended For You" section
- [ ] Red border around "Best Seller" badge

#### Pattern 3: Disguised Ads
- [ ] Red border around "Sponsored" product tags
- [ ] Red border around "Promoted" items

#### Pattern 4: Nagging
- [ ] Red border around newsletter signup modal
- [ ] Red border around notification permission popup

#### Pattern 5: Obstruction
- [ ] Red border around text about account deletion
- [ ] Red border around subscription cancellation info

#### DOM Tests:
- [ ] Sticky banner at top/bottom with urgency text → Red border
- [ ] Countdown timer (if visible) → Red border + "Countdown Timer" label

---

### Test 2: Amazon India (https://www.amazon.in)
**Expected Detections:** 5+ patterns with red borders

#### Pattern 1: False Urgency
- [ ] Red border around "Limited time offer" text
- [ ] Red border around countdown timer elements
- [ ] Red border around "Only X left" badges

#### Pattern 2: Misdirection
- [ ] Red border around "Recommended" tags
- [ ] Red border around "Best Sellers" section

#### Pattern 3: Disguised Ads
- [ ] Red border around "Sponsored Products"
- [ ] Red border around promoted listings

#### Pattern 4: Nagging
- [ ] Red border around "Subscribe for offers" section
- [ ] Red border around notification modals

#### Pattern 5: Obstruction
- [ ] Red border around account deletion instructions
- [ ] Hidden or small unsubscribe link detection

---

### Test 3: Deceptive Design (https://www.deceptive.design/)
**Expected Detections:** 3+ patterns

#### Pattern 1: Forced Continuity
- [ ] Red border around auto-renewal language
- [ ] Red border around "free trial then charge" text

#### Pattern 2: Nagging
- [ ] Red border around repeated prompts
- [ ] Red border around modal dialogs

#### Pattern 3: Obstruction
- [ ] Red border around difficult cancellation paths
- [ ] Red border around "contact to cancel" text

---

## Verification Steps

### Step 1: Check Red Borders Appear
- [ ] Navigate to test site
- [ ] Wait 5 seconds for extension to analyze
- [ ] Red outlines should appear around detected patterns
- [ ] Red borders should pulse with animation

### Step 2: Verify Tooltips
- [ ] Hover over red-bordered element
- [ ] Tooltip appears above/below showing "⚠️ ConsumerShield: [Pattern Name]"
- [ ] Tooltip disappears when mouse leaves element

### Step 3: Check Blue Borders (Privacy)
- [ ] Blue borders should appear around tracker elements (if any)
- [ ] Hover shows "🔒 ConsumerShield: [Tracker Name]"
- [ ] Blue borders do NOT pulse (only red ones pulse)

### Step 4: Browser Console Check
```
Open DevTools (F12) → Console tab

Look for messages like:
✓ [ConsumerShield] Running analysis...
✓ [ConsumerShield] Trackers detected: X
✓ [ConsumerShield] Patterns detected: X
✓ [ConsumerShield] Analysis complete

No error messages should appear
```

### Step 5: Popup UI
- [ ] Click ConsumerShield icon in Chrome toolbar
- [ ] Popup shows privacy risk score (0-10)
- [ ] Popup shows manipulation risk score (0-10)
- [ ] List of detected patterns displays
- [ ] List of detected trackers displays

---

## Troubleshooting

### Issue: No red borders appear
**Solution:**
1. Hard refresh page (Ctrl+Shift+R / Cmd+Shift+R)
2. Check DevTools console for errors (F12 → Console)
3. Re-reload extension (chrome://extensions → refresh icon)
4. Check manifest.json has correct permissions

### Issue: Patterns detected but no borders
**Solution:**
1. Check CSS was injected: Look for `<style id="cs-overlay-styles">` in DevTools
2. Elements might be hidden by page's CSS
3. Check element's z-index is not extremely high
4. Try right-click → Inspect on the element

### Issue: High false positive rate
**Solution:**
1. This is expected for new, aggressive detection
2. Can adjust regex patterns to make stricter
3. Focus on high-severity patterns first
4. Collect real-world data to improve

### Issue: Extension causes page to crash/slow
**Solution:**
1. Check DevTools for JavaScript errors
2. Reduce number of DOM queries in detect functions
3. Add timeout to page analysis (current: 800ms)
4. Consider limiting regex evaluation to top elements only

---

## Regression Testing

### Existing Functionality Must Still Work

- [ ] Tracker detection (blue borders) still works
- [ ] Privacy policy signal detection still works
- [ ] Existing CSS overlays apply correctly
- [ ] No console errors or warnings
- [ ] Extension doesn't slow down page loading
- [ ] Works on mobile e-commerce sites
- [ ] Works on subscription sites
- [ ] Works on SPA (single-page applications)

---

## Commit & Push

```bash
# View changes
git diff

# Commit
git commit -m "Test enhanced dark pattern detection - all 5+ patterns detected"

# Push
git push origin main
```

---

## Success Criteria

✅ **PASS** if:
- Flipkart: 5+ patterns detected with red borders
- Amazon: 5+ patterns detected with red borders
- Deceptive Design: 3+ patterns detected
- No JavaScript errors in console
- Tooltips appear on hover
- Extension loads without issues
- All existing tests still pass

❌ **FAIL** if:
- Fewer than 3 patterns detected on any test site
- Red/blue borders don't appear
- JavaScript errors in console
- Extension crashes page
- Breaking changes to existing functionality

---

## Next Steps After Testing

1. [ ] Document any sites where patterns are NOT detected
2. [ ] Collect false positives (patterns detected that shouldn't be)
3. [ ] Adjust regex patterns based on findings
4. [ ] Test on 10+ additional sites for robustness
5. [ ] Consider ML-based classification vs regex
6. [ ] Integrate with backend for scoring/insights
7. [ ] Deploy to Chrome Web Store

---

**Last Updated:** March 13, 2026  
**Version:** 2.0 (Enhanced Dark Pattern Detection)
