#!/usr/bin/env python3
"""Customises the Capacitor-generated Android project (run after `npx cap add android`).

- landscape, fullscreen game activity that keeps the screen on
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
           r'\n        <item name="android:windowBackground">@android:color/black</item>', s)
open(styles, 'w').write(s)

# Keep the screen on while playing (the web Wake Lock API is not available in
# every WebView).
main = glob.glob(os.path.join(APP, 'java', '**', 'MainActivity.java'), recursive=True)[0]
s = open(main).read()
if 'FLAG_KEEP_SCREEN_ON' not in s:
    s = s.replace('import com.getcapacitor.BridgeActivity;',
                  'import android.os.Bundle;\nimport android.view.WindowManager;\nimport com.getcapacitor.BridgeActivity;')
    s = re.sub(r'public class MainActivity extends BridgeActivity \{\s*\}',
               'public class MainActivity extends BridgeActivity {\n'
               '    @Override\n'
               '    public void onCreate(Bundle savedInstanceState) {\n'
               '        super.onCreate(savedInstanceState);\n'
               '        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);\n'
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
