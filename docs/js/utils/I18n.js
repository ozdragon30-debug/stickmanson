// I18n – tiny translation layer (English + Turkish).
// Language is chosen from settings ('auto' follows the browser language).
// DOM text is translated through data-i18n / data-i18n-title attributes; canvas
// text calls t('key', { vars }) at draw time.

const I18N = {
  en: {
    'menu.name': 'Your name',
    'menu.play': 'Play',
    'menu.loading': 'Loading… {p}%',
    'menu.settings': '⚙ Settings',
    'menu.fullscreen': '⛶ Fullscreen',
    'menu.install': '⬇ Install',
    'menu.controls': 'Controls',
    'menu.about': 'About',
    'menu.status.online0': 'Server online · no other players yet — bots will keep you company',
    'menu.status.online1': 'Server online · 1 other player online',
    'menu.status.onlineN': 'Server online · {n} other players online',
    'menu.status.connecting': 'Connecting to server…',
    'menu.status.offline': 'Offline mode — play against bots',
    'menu.help.1': '<b>WASD / Arrows</b> move · <b>Mouse</b> aim · <b>Click / Space</b> attack',
    'menu.help.2': '<b>Enter</b> chat · <b>Tab / Shift</b> scoreboard · <b>Esc</b> settings · <b>M</b> mute',
    'menu.help.3': '<b>Gamepad</b>: left stick move, right stick aim, RT attack',
    'menu.help.4': '<b>Touch</b>: left thumb move, right thumb aim &amp; attack',
    'menu.help.5': 'Walk over weapons to pick them up. Most kills when the timer ends wins.',
    'menu.about.text': '<strong>Stick Clash</strong> is based on Stick Arena, a browser-based multiplayer shooter created by XGenStudios. After Flash was discontinued, the official servers went offline. This is an open-source <strong>HTML5 reimplementation</strong> with all original maps, weapons and sprites. Play offline against bots right here, or host your own server for multiplayer.',
    'menu.legal': 'Game assets © XGenStudios — non-commercial use only (CC BY-NC-SA 4.0).',
    'menu.stats': 'Your stats',
    'hint.title': 'HOW TO PLAY',
    'hint.keys': 'WASD move · Mouse aim · Click attack · Tab scores',
    'hint.touch': 'Left thumb move · Right thumb aim & fire',
    'hint.pad': 'Left stick move · Right stick aim · RT attack',
    'menu.iosInstall': 'Tap the Share button, then "Add to Home Screen" to install Stick Clash.',
    'menu.recent': 'Recent rooms:',
    'menu.server.connect': 'Connect', 'menu.server.hint': 'Game server address, e.g. https://stick.example.com',
    'menu.map.featured': 'Featured',
    'menu.map': 'Map (offline)', 'menu.map.random': '🎲 Random rotation',
    'stats.kills': 'Kills', 'stats.deaths': 'Deaths', 'stats.kd': 'K/D ratio', 'stats.wins': 'Rounds won',
    'stats.streak': 'Best kill streak', 'stats.weapon': 'Favourite weapon', 'stats.time': 'Time played',
    'stats.reset': 'Reset stats', 'stats.confirmReset': 'Reset all your stats?',
    'stats.hm': '{h}h {m}m', 'stats.m': '{m}m', 'set.menu': 'Main menu',
    'menu.room.public': 'Public room',
    'menu.room.private': 'Private room <b>{code}</b>',
    'menu.room.create': 'Create private room',
    'menu.room.copy': 'Copy invite link',
    'menu.room.copied': 'Link copied!',
    'menu.room.shareText': 'Join my Stick Clash room!',

    'set.title': 'Settings',
    'set.tab.profile': 'Profile', 'set.tab.controls': 'Controls', 'set.tab.audio': 'Audio', 'set.tab.video': 'Video', 'set.tab.hud': 'HUD',
    'set.name': 'Player Name', 'set.cursor': 'Cursor', 'set.spinner': 'Spinner Shape', 'set.color': 'Spinner Color',
    'set.language': 'Language', 'set.lang.auto': 'Auto (browser)',
    'set.keybinds': 'Keybinds', 'set.arrows': '(arrow keys always move too)',
    'set.touch': 'Touch Controls', 'set.touch.auto': 'Auto (touch screens)', 'set.touch.on': 'Always on', 'set.touch.off': 'Off', 'set.touch.left': 'Left-handed (aim with the left thumb)',
    'set.gamepad': 'Gamepad',
    'set.gamepad.help': 'Left stick / D-pad: move · Right stick: aim · RT / A: attack · Back/View: scoreboard · Start: settings',
    'set.gamepad.none': 'No gamepad detected — press any button on it.',
    'set.gamepad.on': 'Connected: {name}',
    'set.volume': 'Volume', 'set.mute': 'Mute all sounds', 'set.spatial': 'Positional audio',
    'set.spatial.hint': '— pan & soften other players\' sounds by distance',
    'set.res': 'Render Resolution', 'set.res.auto': 'Auto (sharp, up to 2×)', 'set.res.high': 'High (native, up to 3×)', 'set.res.low': 'Low (1× – fastest)',
    'set.pixel': 'Pixel-art scaling', 'set.pixel.hint': '— crisp nearest-neighbour sprites',
    'set.fpsLimit': 'Frame rate limit', 'set.fpsLimit.off': 'Monitor refresh rate (unlimited)', 'set.fpsLimit.auto': 'Auto (refresh rate, steady 60 if the device can\'t keep up)', 'set.fpsLimit.30': '30 FPS (battery saver)',
    'set.view': 'Screen', 'set.view.wide': 'Fill screen (bigger, same view area)', 'set.view.classic': 'Classic 4:3 (dimmed map at the sides)', 'set.view.off': 'Classic 4:3 (black bars)',
    'set.smooth': 'Smooth animations (60 fps)', 'set.smooth.hint': '— in-between drawings; game speed unchanged',
    'set.fx': 'Modern effects', 'set.fx.hint': '— shadows, weapon glow, muzzle light (looks only)',
    'set.fps': 'Show FPS', 'set.ping': 'Show ping', 'set.fullscreen': 'Toggle Fullscreen',
    'set.killfeed': 'Kill feed', 'set.hitmarkers': 'Hit markers', 'set.damageflash': 'Damage flash',
    'set.reset': 'Reset to defaults', 'set.done': 'Done', 'set.press': 'Press a key…',
    'set.bind.up': 'Move Up', 'set.bind.left': 'Move Left', 'set.bind.down': 'Move Down', 'set.bind.right': 'Move Right', 'set.bind.shoot': 'Attack',
    'set.keys.extra': 'Mouse: aim & attack · Enter: chat · Tab / Shift: scoreboard · M: mute',

    'hud.died': 'YOU DIED', 'hud.killedBy': 'Killed by {name} — respawning…', 'hud.respawning': 'Respawning…',
    'hud.eliminated': 'ELIMINATED {name}', 'hud.you': 'You',
    'hud.streak.2': 'DOUBLE KILL', 'hud.streak.3': 'TRIPLE KILL', 'hud.streak.4': 'MULTI KILL', 'hud.streak.5': 'RAMPAGE',
    'hud.reconnecting': 'Connection lost — reconnecting…',
    'hud.soundOn': 'SOUND ON', 'hud.soundOff': 'SOUND OFF', 'hud.disconnected': 'DISCONNECTED',
    'hud.move': 'MOVE', 'hud.aim': 'AIM + FIRE', 'hud.mapBy': 'by {name}', 'hud.rotate': 'Rotate your device for a bigger view', 'chat.server': 'Server', 'tab.joined': 'Player joined',
    'chat.quick': 'gg|hi!|nice shot|lol|wp|one more round?',
    'chat.muted': 'Muted {name} (only for you). !unmute {name} to undo.', 'chat.unmuted': 'Unmuted {name}.',
    'chat.help': '!fps – toggle FPS counter · !debug – collision overlay · !mute / !unmute <name>\n!map <name> / !next – change map (offline)\nAdmins: !next !kick !ban !weapon !debugmap · !login <password>',
    'hud.botsOffline': 'Offline — playing against bots', 'hud.botsWaiting': 'Waiting for players — playing against bots',

    'sb.title': 'SCOREBOARD', 'sb.over': 'ROUND OVER', 'sb.player': 'PLAYER', 'sb.kills': 'KILLS', 'sb.deaths': 'DEATHS', 'sb.kd': 'K/D',
    'sb.youWin': 'You win!', 'sb.wins': '{name} wins!', 'sb.left': '{t} left', 'sb.you': '(you)', 'sb.more': '+{n} more',
  },
  tr: {
    'menu.name': 'Adın',
    'menu.play': 'Oyna',
    'menu.loading': 'Yükleniyor… %{p}',
    'menu.settings': '⚙ Ayarlar',
    'menu.fullscreen': '⛶ Tam ekran',
    'menu.install': '⬇ Yükle',
    'menu.controls': 'Kontroller',
    'menu.about': 'Hakkında',
    'menu.status.online0': 'Sunucu çevrimiçi · henüz başka oyuncu yok — botlar sana eşlik edecek',
    'menu.status.online1': 'Sunucu çevrimiçi · 1 oyuncu daha var',
    'menu.status.onlineN': 'Sunucu çevrimiçi · {n} oyuncu daha var',
    'menu.status.connecting': 'Sunucuya bağlanılıyor…',
    'menu.status.offline': 'Çevrimdışı mod — botlara karşı oyna',
    'menu.help.1': '<b>WASD / Ok tuşları</b> hareket · <b>Fare</b> nişan · <b>Tık / Boşluk</b> saldırı',
    'menu.help.2': '<b>Enter</b> sohbet · <b>Tab / Shift</b> skor tablosu · <b>Esc</b> ayarlar · <b>M</b> sessiz',
    'menu.help.3': '<b>Gamepad</b>: sol çubuk hareket, sağ çubuk nişan, RT saldırı',
    'menu.help.4': '<b>Dokunmatik</b>: sol başparmak hareket, sağ başparmak nişan &amp; ateş',
    'menu.help.5': 'Silahları almak için üzerlerinden geç. Süre bittiğinde en çok öldüren kazanır.',
    'menu.about.text': '<strong>Stick Clash</strong>, Stick Arena\'ya dayanır. Stick Arena, XGenStudios\'un yaptığı tarayıcı tabanlı çok oyunculu bir nişancı oyunuydu. Flash kaldırılınca resmi sunucular kapandı. Bu, tüm orijinal haritalar, silahlar ve sprite\'larla açık kaynak bir <strong>HTML5 yeniden yapımı</strong>. Burada botlara karşı çevrimdışı oyna ya da çok oyunculu için kendi sunucunu kur.',
    'menu.legal': 'Oyun varlıkları © XGenStudios — yalnızca ticari olmayan kullanım (CC BY-NC-SA 4.0).',
    'menu.stats': 'İstatistiklerin',
    'hint.title': 'NASIL OYNANIR',
    'hint.keys': 'WASD hareket · Fare nişan · Tık saldırı · Tab skorlar',
    'hint.touch': 'Sol başparmak hareket · Sağ başparmak nişan & ateş',
    'hint.pad': 'Sol çubuk hareket · Sağ çubuk nişan · RT saldırı',
    'menu.iosInstall': 'Yüklemek için Paylaş düğmesine, ardından "Ana Ekrana Ekle"ye dokun.',
    'menu.recent': 'Son odalar:',
    'menu.server.connect': 'Bağlan', 'menu.server.hint': 'Oyun sunucusu adresi, örn. https://stick.example.com',
    'menu.map.featured': 'Öne çıkanlar',
    'menu.map': 'Harita (çevrimdışı)', 'menu.map.random': '🎲 Rastgele sıra',
    'stats.kills': 'Leş', 'stats.deaths': 'Ölüm', 'stats.kd': 'L/Ö oranı', 'stats.wins': 'Kazanılan tur',
    'stats.streak': 'En iyi seri', 'stats.weapon': 'Favori silah', 'stats.time': 'Oynama süresi',
    'stats.reset': 'İstatistikleri sıfırla', 'stats.confirmReset': 'Tüm istatistiklerin sıfırlansın mı?',
    'stats.hm': '{h} sa {m} dk', 'stats.m': '{m} dk', 'set.menu': 'Ana menü',
    'menu.room.public': 'Genel oda',
    'menu.room.private': 'Özel oda <b>{code}</b>',
    'menu.room.create': 'Özel oda oluştur',
    'menu.room.copy': 'Davet linkini kopyala',
    'menu.room.copied': 'Link kopyalandı!',
    'menu.room.shareText': 'Stick Clash odama gel!',

    'set.title': 'Ayarlar',
    'set.tab.profile': 'Profil', 'set.tab.controls': 'Kontroller', 'set.tab.audio': 'Ses', 'set.tab.video': 'Görüntü', 'set.tab.hud': 'Arayüz',
    'set.name': 'Oyuncu Adı', 'set.cursor': 'İmleç', 'set.spinner': 'Spinner Şekli', 'set.color': 'Spinner Rengi',
    'set.language': 'Dil', 'set.lang.auto': 'Otomatik (tarayıcı)',
    'set.keybinds': 'Tuş Atamaları', 'set.arrows': '(ok tuşları her zaman hareket ettirir)',
    'set.touch': 'Dokunmatik Kontroller', 'set.touch.auto': 'Otomatik (dokunmatik ekranlar)', 'set.touch.on': 'Her zaman açık', 'set.touch.off': 'Kapalı', 'set.touch.left': 'Solak modu (sol başparmakla nişan al)',
    'set.gamepad': 'Gamepad',
    'set.gamepad.help': 'Sol çubuk / D-pad: hareket · Sağ çubuk: nişan · RT / A: saldırı · Back/View: skor tablosu · Start: ayarlar',
    'set.gamepad.none': 'Gamepad bulunamadı — üzerindeki herhangi bir tuşa bas.',
    'set.gamepad.on': 'Bağlı: {name}',
    'set.volume': 'Ses Seviyesi', 'set.mute': 'Tüm sesleri kapat', 'set.spatial': 'Konumsal ses',
    'set.spatial.hint': '— diğer oyuncuların seslerini mesafeye göre yönlendir ve kıs',
    'set.res': 'Çözünürlük', 'set.res.auto': 'Otomatik (keskin, 2×\'e kadar)', 'set.res.high': 'Yüksek (yerel, 3×\'e kadar)', 'set.res.low': 'Düşük (1× – en hızlı)',
    'set.pixel': 'Piksel-art ölçekleme', 'set.pixel.hint': '— keskin, yumuşatmasız sprite\'lar',
    'set.fpsLimit': 'FPS sınırı', 'set.fpsLimit.off': 'Monitör yenileme hızı (sınırsız)', 'set.fpsLimit.auto': 'Otomatik (yenileme hızı; cihaz yetişemezse sabit 60)', 'set.fpsLimit.30': '30 FPS (pil tasarrufu)',
    'set.view': 'Ekran', 'set.view.wide': 'Ekranı doldur (daha büyük, aynı görüş alanı)', 'set.view.classic': 'Klasik 4:3 (kenarlarda soluk harita)', 'set.view.off': 'Klasik 4:3 (siyah kenarlar)',
    'set.smooth': 'Akıcı animasyonlar (60 FPS)', 'set.smooth.hint': '— ara çizimler; oyun hızı değişmez',
    'set.fx': 'Modern efektler', 'set.fx.hint': '— gölgeler, silah parlaması, namlu ışığı (sadece görüntü)',
    'set.fps': 'FPS göster', 'set.ping': 'Ping göster', 'set.fullscreen': 'Tam Ekranı Aç/Kapat',
    'set.killfeed': 'Öldürme akışı', 'set.hitmarkers': 'İsabet işareti', 'set.damageflash': 'Hasar flaşı',
    'set.reset': 'Varsayılana dön', 'set.done': 'Tamam', 'set.press': 'Bir tuşa bas…',
    'set.bind.up': 'Yukarı', 'set.bind.left': 'Sola', 'set.bind.down': 'Aşağı', 'set.bind.right': 'Sağa', 'set.bind.shoot': 'Saldırı',
    'set.keys.extra': 'Fare: nişan & saldırı · Enter: sohbet · Tab / Shift: skor tablosu · M: sessiz',

    'hud.died': 'ÖLDÜN', 'hud.killedBy': '{name} öldürdü — yeniden doğuluyor…', 'hud.respawning': 'Yeniden doğuluyor…',
    'hud.eliminated': '{name} ELENDİ', 'hud.you': 'Sen',
    'hud.streak.2': 'ÇİFT LEŞ', 'hud.streak.3': 'ÜÇLÜ LEŞ', 'hud.streak.4': 'SERİ LEŞ', 'hud.streak.5': 'KATLİAM',
    'hud.reconnecting': 'Bağlantı koptu — yeniden bağlanılıyor…',
    'hud.soundOn': 'SES AÇIK', 'hud.soundOff': 'SES KAPALI', 'hud.disconnected': 'BAĞLANTI KESİLDİ',
    'hud.move': 'HAREKET', 'hud.aim': 'NİŞAN + ATEŞ', 'hud.mapBy': 'yapan: {name}', 'hud.rotate': 'Daha büyük görüntü için cihazı yan çevir', 'chat.server': 'Sunucu', 'tab.joined': 'Oyuncu katıldı',
    'chat.quick': 'gg|selam!|iyi atış|haha|eline sağlık|bir tur daha?',
    'chat.muted': '{name} susturuldu (sadece senin için). Geri almak için !unmute {name}', 'chat.unmuted': '{name} artık susturulmuyor.',
    'chat.help': '!fps – FPS sayacı · !debug – çarpışma katmanı · !mute / !unmute <isim>\n!map <ad> / !next – harita değiştir (çevrimdışı)\nYöneticiler: !next !kick !ban !weapon !debugmap · !login <şifre>',
    'hud.botsOffline': 'Çevrimdışı — botlara karşı oynanıyor', 'hud.botsWaiting': 'Oyuncu bekleniyor — botlara karşı oynanıyor',

    'sb.title': 'SKOR TABLOSU', 'sb.over': 'TUR BİTTİ', 'sb.player': 'OYUNCU', 'sb.kills': 'LEŞ', 'sb.deaths': 'ÖLÜM', 'sb.kd': 'L/Ö',
    'sb.youWin': 'Kazandın!', 'sb.wins': '{name} kazandı!', 'sb.left': '{t} kaldı', 'sb.you': '(sen)', 'sb.more': '+{n} oyuncu daha',
  },
};

// Server / system chat lines translated on the client (server stays English).
const I18N_CHAT_TR = [
  [/^(.+) joined the game\.$/, '$1 oyuna katıldı.'],
  [/^(.+) left the game\.$/, '$1 oyundan ayrıldı.'],
  [/^Round over! Next round starting in (\d+(?:\.\d+)?) seconds\.\.\.$/, 'Tur bitti! Yeni tur $1 saniye içinde başlıyor...'],
  [/^Round started on (.+?) \(by (.+)\)!$/, 'Tur başladı: $1 (yapan: $2)!'],
  [/^Round started on (.+)!$/, 'Tur başladı: $1!'],
  [/^(.+) is now known as (.+)\.$/, '$1 artık $2 olarak biliniyor.'],
  [/^No player named "(.+)"\.$/, '"$1" adında oyuncu yok.'],
  [/^Debug map ON .*$/, 'Debug haritası AÇIK — yeni tur başlıyor...'],
  [/^Debug map OFF .*$/, 'Debug haritası KAPALI — yeni tur başlıyor...'],
  [/^You have been removed from the server\.$/, 'Sunucudan çıkarıldın.'],
  [/^Too many connections from your address\.$/, 'Adresinden çok fazla bağlantı var.'],
  [/^Waiting for other players, playing against bots\.$/, 'Diğer oyuncular bekleniyor, botlara karşı oynanıyor.'],
  [/^No connection to the server, playing against bots\.$/, 'Sunucu bağlantısı yok, botlara karşı oynanıyor.'],
  [/^No server found — playing offline with bots\.$/, 'Sunucu bulunamadı — botlarla çevrimdışı oynanıyor.'],
  [/^You are sending messages too fast\.$/, 'Çok hızlı mesaj gönderiyorsun.'],
  [/^Gamepad connected\.$/, 'Gamepad bağlandı.'],
  [/^Server is restarting…$/, 'Sunucu yeniden başlatılıyor…'],
  [/^Unknown map: (.+)$/, 'Bilinmeyen harita: $1'],
  [/^Something went wrong — the game recovered\. Reload if it misbehaves\.$/, 'Bir hata oluştu — oyun toparlandı. Sorun devam ederse sayfayı yenile.'],
  [/^(.+) was kicked\.$/, '$1 atıldı.'],
  [/^(.+) was banned\.$/, '$1 yasaklandı.'],
  [/^Kicked by admin\.$/, 'Yönetici tarafından atıldın.'],
  [/^Banned by admin\.$/, 'Yönetici tarafından yasaklandın.'],
  [/^You are banned\.$/, 'Yasaklısın.'],
  [/^This room is full\.$/, 'Bu oda dolu.'],
  [/^Admin access granted\.$/, 'Yönetici erişimi verildi.'],
  [/^Invalid admin password\.$/, 'Geçersiz yönetici şifresi.'],
];

const i18n = {
  lang: 'en',
  listeners: [],

  resolve(pref) {
    if (pref === 'en' || pref === 'tr') return pref;
    const langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
    return langs.some(l => /^tr\b/i.test(l)) ? 'tr' : 'en';
  },

  setLanguage(pref) {
    this.lang = this.resolve(pref);
    document.documentElement.lang = this.lang;
    this.applyDom();
    for (const fn of this.listeners) fn(this.lang);
  },

  onChange(fn) { this.listeners.push(fn); },

  applyDom(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
    root.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  },

  chat(text) {
    if (this.lang !== 'tr' || typeof text !== 'string') return text;
    for (const [re, rep] of I18N_CHAT_TR) if (re.test(text)) return text.replace(re, rep);
    return text;
  },
};

// "Paris Streets (by Warjag)" → { title: 'Paris Streets', author: 'Warjag' };
// all-lowercase names are title-cased.
function splitMapName(name) {
  const m = /^(.*?)\s*\(by (.+)\)\s*$/.exec(name || '');
  let title = m ? m[1] : (name || '');
  if (title && !/[A-Z]/.test(title)) title = title.replace(/(^|\s)\S/g, c => c.toUpperCase());
  return { title, author: m ? m[2] : null };
}

// Localised one-line map label: "Paris Streets · by Warjag" / "… · yapan: Warjag".
function mapLabelLocal(name) {
  const { title, author } = splitMapName(name);
  return author ? `${title} · ${t('hud.mapBy', { name: author })}` : title;
}

function t(key, vars) {
  const s = (I18N[i18n.lang] && I18N[i18n.lang][key]) ?? I18N.en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '')) : s;
}

i18n.lang = i18n.resolve('auto');
