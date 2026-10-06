#!/usr/bin/env python3
"""Customises the Capacitor-generated Android project (run after `npx cap add android`).

- landscape, immersive fullscreen game activity (no status/navigation bars)
  that keeps the screen on; drawn under the camera cutout
- the game's own launcher icon and a dark splash screen
Requires: pip install pillow
"""
import glob, os, re, shutil, sys
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..')
APP = os.path.join(ROOT, 'android', 'app', 'src', 'main')
RES = os.path.join(APP, 'res')
ICON = os.path.join(ROOT, 'docs', 'icons', 'icon-512.png')
BG = (14, 22, 33, 255)  # #0e1621, the game's theme colour

# Activity: landscape (either way up), handled resizes stay in-app.
manifest = os.path.join(APP, 'AndroidManifest.xml')
s = open(manifest).read()
if 'screenOrientation' not in s:
    s = s.replace('android:name=".MainActivity"',
                  'android:name=".MainActivity"\n            android:screenOrientation="sensorLandscape"')
open(manifest, 'w').write(s)

# Fullscreen, no title bar, dark window background.
styles = os.path.join(RES, 'values', 'styles.xml')
s = open(styles).read()
s = re.sub(r'(<style name="AppTheme.NoActionBar"[^>]*>)',
           r'\1\n        <item name="android:windowFullscreen">true</item>'
           r'\n        <item name="android:windowBackground">@android:color/black</item>'
           r'\n        <item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>', s)
open(styles, 'w').write(s)

# Keep the screen on while playing (the web Wake Lock API is not available in
# every WebView) and hide the status and navigation bars (immersive mode: a
# swipe from the edge shows them briefly).
main = glob.glob(os.path.join(APP, 'java', '**', 'MainActivity.java'), recursive=True)[0]
s = open(main).read()
if 'FLAG_KEEP_SCREEN_ON' not in s:
    s = s.replace('import com.getcapacitor.BridgeActivity;',
                  'import android.os.Bundle;\n'
                  'import android.view.WindowManager;\n'
                  'import androidx.core.view.WindowCompat;\n'
                  'import androidx.core.view.WindowInsetsCompat;\n'
                  'import androidx.core.view.WindowInsetsControllerCompat;\n'
                  'import com.getcapacitor.BridgeActivity;')
    s = re.sub(r'public class MainActivity extends BridgeActivity \{\s*\}',
               'public class MainActivity extends BridgeActivity {\n'
               '    @Override\n'
               '    public void onCreate(Bundle savedInstanceState) {\n'
               '        super.onCreate(savedInstanceState);\n'
               '        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);\n'
               '        hideSystemBars();\n'
               '    }\n'
               '\n'
               '    @Override\n'
               '    public void onWindowFocusChanged(boolean hasFocus) {\n'
               '        super.onWindowFocusChanged(hasFocus);\n'
               '        if (hasFocus) hideSystemBars();\n'
               '    }\n'
               '\n'
               '    private void hideSystemBars() {\n'
               '        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);\n'
               '        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());\n'
               '        c.hide(WindowInsetsCompat.Type.systemBars());\n'
               '        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);\n'
               '    }\n'
               '}', s)
    open(main, 'w').write(s)

# Launcher icons: use the plain PNGs (drop the adaptive-icon XML).
shutil.rmtree(os.path.join(RES, 'mipmap-anydpi-v26'), ignore_errors=True)
icon = Image.open(ICON).convert('RGBA')
for d in glob.glob(os.path.join(RES, 'mipmap-*')):
    for name in ('ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png'):
        p = os.path.join(d, name)
        if os.path.exists(p):
            size = Image.open(p).size
            icon.resize(size, Image.LANCZOS).save(p)

# Splash screens: dark background with the icon in the middle.
for p in glob.glob(os.path.join(RES, 'drawable*', 'splash.png')):
    w, h = Image.open(p).size
    img = Image.new('RGBA', (w, h), BG)
    s = min(w, h) // 3
    img.alpha_composite(icon.resize((s, s), Image.LANCZOS), ((w - s) // 2, (h - s) // 2))
    img.convert('RGB').save(p)

print('android project customised')
