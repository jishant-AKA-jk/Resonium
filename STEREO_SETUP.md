# 🎧 FIXED: True Stereo + Sync + Individual Volume Control

## What's Fixed? ✅

### 1. **TRUE Stereo Channel Separation**
- **LEFT device**: Plays ONLY left channel (right completely muted)
- **RIGHT device**: Plays ONLY right channel (left completely muted)
- **BOTH**: Plays full stereo (both channels)
- Uses proper Web Audio API channel splitter/merger

### 2. **Audio Synchronization**
- Periodic time sync between server and clients
- Reduced network latency impact
- Better sync between multiple devices

### 3. **Individual Volume Control from Server**
- Each device has its own volume slider on server page
- Server can adjust each device independently
- Perfect for balancing left/right speakers

---

## 🚨 CRITICAL: Verify Stereo Input

Before anything else, make sure Windows is capturing TRUE stereo:

### Check Recording Device:

1. **Right-click speaker icon → Sounds**
2. **Recording tab**
3. **Right-click "CABLE Output" → Properties**
4. **Advanced tab**
5. **MUST show: "2 channel, 16 bit, 48000 Hz" or higher**
6. If it shows "1 channel" - **CHANGE IT TO 2 CHANNEL**
7. Click **Apply** and **OK**

### Verify in App:

When you start the server, check the console (F12):
- Should say: **"channelCount: 2"**
- If it says **"channelCount: 1"** → You have MONO input (won't work!)

---

## 🧪 Testing TRUE Stereo Separation

### Test 1: Single Device Test

1. **YouTube search**: "left right audio test"
2. **Play the video**
3. **Connect ONE phone** as receiver
4. **Set channel to LEFT**:
   - Should ONLY hear when video says "LEFT"
   - Should hear NOTHING when video says "RIGHT"
5. **Switch to RIGHT**:
   - Should ONLY hear when video says "RIGHT"
   - Should hear NOTHING when video says "LEFT"
6. **Switch to BOTH**:
   - Should hear both sides

**If you hear both channels regardless of setting → Stereo separation NOT working!**

### Test 2: Two Device Test

1. **Connect 2 phones**
2. **Phone 1**: Will auto-assign to LEFT (🔴)
3. **Phone 2**: Will auto-assign to RIGHT (🔵)
4. **YouTube**: Search "8D audio test" or "stereo panning test"
5. **Play video**:
   - Sound should move between phones
   - When it pans left → only LEFT phone plays
   - When it pans right → only RIGHT phone plays

### Test 3: Dolby Atmos Test

1. **YouTube**: "Dolby Atmos demo"
2. **Use 2 phones** (LEFT + RIGHT)
3. **Place phones 6-8 feet apart**
4. **Sit in the middle**
5. You should hear:
   - Sounds moving from left to right
   - Height effects (if the content has them)
   - Surround-like experience

---

## 🎛️ Using Individual Volume Control

**On Server page**, each connected device shows:

```
[Device Name] [◀️ LEFT]  [=========|---] 75%
```

- **Drag the slider** to adjust that device's volume
- Changes apply immediately
- Use this to **balance left/right** speakers
- Example: If right speaker is louder, lower its volume

**Why this matters:**
- Different phones have different speaker volumes
- Room acoustics may require balancing
- You might place one phone farther away

---

## 🔧 Troubleshooting

### ❌ "Still sounds the same on LEFT and RIGHT"

**Problem:** Stereo separation not working

**Solutions:**
1. **Check Windows audio:**
   - CABLE Output MUST be 2 channel (not 1 channel)
   - Restart server after changing this
2. **Check console logs:**
   - F12 on server page
   - Look for "channelCount: 2"
   - If it shows 1, stereo isn't being captured
3. **Test with headphones:**
   - Connect ONE device
   - Set to LEFT, plug in headphones
   - Should only hear in left ear
   - Set to RIGHT, should only hear in right ear

### ❌ "Audio is out of sync between devices"

**Causes:** Network latency

**Solutions:**
1. **Use 5GHz WiFi** (if available) - much better than 2.4GHz
2. **Reduce WiFi interference:**
   - Move router closer
   - Reduce other WiFi traffic
   - Close bandwidth-heavy apps
3. **Check network:**
   - Open console (F12)
   - Look for "Network latency: XXms"
   - Should be under 50ms
   - Over 100ms = too much latency
4. **Physical workaround:**
   - Slightly delay one device by moving it back 1-2 feet
   - Sound travels ~1 foot per millisecond

### ❌ "Volume slider on server doesn't work"

**Solutions:**
1. **Refresh the server page** after clients connect
2. **Check that device shows correct volume value**
3. **Try adjusting from phone first**, then from server

### ❌ "One device is much louder than the other"

**This is normal!** Different phones have different speaker volumes.

**Fix:**
- Use **server volume controls** to balance them
- Lower the louder device's volume
- Or increase the quieter one (if not at 100%)

---

## 📝 Step-by-Step Setup for Best Experience

### For Movie Watching (2 devices):

1. **Windows PC:**
   - Set output to: CABLE Input
   - Set recording to: CABLE Output (2 channel, 48000 Hz)

2. **Start Server:**
   ```bash
   node server.js
   ```

3. **Connect Phones:**
   - Phone 1: Name it "Left Speaker"
   - Phone 2: Name it "Right Speaker"
   - They auto-assign to LEFT/RIGHT

4. **Physical Setup:**
   ```
        [PC Screen]
             |
       +-----------+
       |           |
   [Left]      [Right]
   Phone1      Phone2
       |           |
       +-----+-----+
             |
          [You]
   ```

5. **Balance Volume:**
   - On server, adjust each phone's volume slider
   - Make them equal loudness
   - Test with dialogue - should sound centered

6. **Play Movie:**
   - Full screen on PC
   - Dolby Atmos/5.1 content recommended
   - Turn off phone screens (audio continues!)

### For Single Device Dolby Atmos:

1. **Connect ONE phone**
2. **Set channel to BOTH**
3. **Use good headphones or phone's stereo speakers**
4. **Play Dolby Atmos content**
5. Should get full stereo/spatial audio

---

## 🎬 Best Content to Test

### YouTube Searches:
1. **"left right stereo test"** - Basic stereo test
2. **"8D audio test"** - Panning test
3. **"Dolby Atmos demo"** - Full surround demo
4. **"binaural audio test"** - 3D audio test
5. **"audiophile test track"** - High quality music

### Movie Recommendations (with Dolby Atmos):
- Netflix: Most new movies/shows
- YouTube: Many movie trailers in Atmos
- VLC: Play local Dolby Atmos files

---

## 💡 Pro Tips

### Optimal Phone Placement:
```
Distance: 6-10 feet apart
Height: Ear level when seated
Angle: Pointed toward listening position
```

### For Best Sync:
- Use 5GHz WiFi network
- Close background apps on phones
- Keep phones plugged in (prevents CPU throttling)
- Disable WiFi power saving on phones

### Volume Leveling:
1. Play pink noise or test tone
2. Use server sliders to match loudness
3. Save mental note of settings
4. Adjust per room/content as needed

### Battery Life:
- Screen can turn off (audio continues!)
- Keep phones plugged in for long sessions
- Wake lock keeps app active

---

## 🆘 Still Having Issues?

### Check Console Logs:

**On Server (PC):**
- F12 → Console
- Look for: "channelCount: 2"
- Look for: "✓ Added track: audio"

**On Client (Phone):**
- Enable USB debugging (Android)
- Or use browser remote debugging
- Look for: "✓ Audio graph configured for LEFT/RIGHT"

### Common Mistakes:

1. ❌ Recording device is MONO (1 channel)
   - ✅ MUST be STEREO (2 channel)

2. ❌ Forgot to restart server after changing audio settings
   - ✅ Always restart after Windows audio changes

3. ❌ Using 2.4GHz WiFi
   - ✅ Use 5GHz for lower latency

4. ❌ Phones in battery saver mode
   - ✅ Disable battery optimization for browser

---

## 🎯 Expected Results

### If Everything Works:

**LEFT device:**
- Plays ONLY left audio
- Headphone test: Only left ear
- Stereo test video: Only hears "LEFT"

**RIGHT device:**
- Plays ONLY right audio
- Headphone test: Only right ear
- Stereo test video: Only hears "RIGHT"

**BOTH device:**
- Plays full stereo
- Hears everything

**Sync:**
- Two devices within 10-50ms of each other
- Barely noticeable delay
- Can be fine-tuned with physical positioning

**Server Controls:**
- Each device has independent volume
- Changes apply instantly
- Can balance speakers perfectly

---

## 📊 Network Latency Guide

| Latency | Experience | Solution |
|---------|-----------|----------|
| 0-30ms | Perfect | Excellent! |
| 30-50ms | Very Good | Acceptable |
| 50-100ms | Noticeable | Use 5GHz WiFi |
| 100ms+ | Problematic | Check network |

Check latency in console: "Network latency: XXms"

---

If it's still not working, share:
1. Console logs from server (F12)
2. Windows recording device properties screenshot
3. Which test fails (left/right/both)

Let's get that cinema experience working! 🎬🍿