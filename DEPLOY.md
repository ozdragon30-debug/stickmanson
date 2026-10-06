# Yayına alma rehberi (Türkçe)

Oyunu arkadaşlarınla internette oynamak için birkaç yol var. Hepsinde oyun aynı:
sunucu (`app.js`) hem sayfayı hem çok oyunculu bağlantıyı (socket.io) sunar.

## 1) Kendi bilgisayarında (aynı ev / LAN)

```bash
npm install
npm start
```

- Sen: `http://localhost:1138`
- Aynı ağdaki arkadaşların: `http://<bilgisayarının-yerel-IP'si>:1138`
  (Windows: `ipconfig`, macOS/Linux: `ip a` / `ifconfig` ile öğrenebilirsin)
- Windows Güvenlik Duvarı sorarsa Node.js'e izin ver.
- Aynı ağdan bağlananlar otomatik **admin** sayılır (`!next`, `!kick` …).

İnternetten bağlanmaları için modeminden 1138 portunu bilgisayarına yönlendirmen
(port forwarding) gerekir; daha kolayı aşağıdaki seçenekler.

## 2) VPS (Hetzner, DigitalOcean, Oracle Free…) + Docker

```bash
git clone <bu repo> stick-arena && cd stick-arena
docker compose up -d          # http://SUNUCU_IP:1138
```

`docker-compose.yml` içinde `ADMIN_PASSWORD` satırını açıp bir şifre koy;
oyunda sohbete `!login şifre` yazınca admin olursun (Docker içinde "aynı ağ =
admin" kuralı kapalıdır, çünkü Docker'ın NAT'ı herkesi yerel gösterebilir).
Ban listesi kalıcıdır.

### Alan adı + HTTPS (nginx)

WebSocket için `Upgrade` başlıkları şart:

```nginx
server {
    server_name stick.ornek.com;
    location / {
        proxy_pass http://127.0.0.1:1138;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 60s;
    }
}
```

HTTPS için: `sudo certbot --nginx -d stick.ornek.com`.

**Önemli:** proxy arkasında `TRUST_PROXY=1` ayarla (compose dosyasında
yorumlu satır). Ayarlamazsan herkes nginx'in adresinden geliyor görünür:
IP başına bağlantı sınırı tüm sunucuya uygulanır ve ban'lar herkesi etkiler.
Ayrıca compose'daki portu `"127.0.0.1:1138:1138"` yap; böylece kimse nginx'i
atlayıp doğrudan 1138'e bağlanarak sahte IP başlığı gönderemez.

## 3) Render / Railway / Fly.io (sunucu yönetmeden)

- Yeni bir **Web Service** oluştur, bu repoyu bağla.
- Build: `npm ci --omit=dev` · Start: `node app.js`
  (veya Dockerfile'ı kullanmasını seç)
- Ortam değişkenleri: `TRUST_PROXY=1`, istersen `ADMIN_PASSWORD=…`
- Platform `PORT` değişkenini kendisi verir; sunucu onu kullanır.
- Sağlık kontrolü yolu: `/healthz`

Not: ücretsiz planlar boşta kalınca uyuyabilir; ilk açılış birkaç saniye sürer.

## 4) GitHub Pages (sadece sayfa) + ayrı sunucu

Repo ayarlarında **Pages → Branch: … / folder: `/docs`** seçersen oyun
`https://<kullanıcı>.github.io/<repo>/` adresinde açılır ve sunucu olmadan
**botlara karşı** oynanır (uygulama olarak da kurulabilir).

Bu sayfadan çevrimiçi oynamak için menüdeki **"Bağlan"** alanına sunucunun
adresini yaz, ya da linke `?server=https://stick.ornek.com` ekle.

## 5) Android uygulaması (APK)

`docs/` klasöründeki her değişiklikte GitHub Actions ("Android APK" iş akışı)
bir APK derler ve reponun **Releases → Android APK (latest build)** sayfasına
koyar. Telefondan `StickArenaReborn.apk` dosyasını indirip aç; Android
"bilinmeyen kaynaklardan yükleme" izni ister.

- Uygulama yatay ve tam ekran açılır, ekran kapanmaz.
- Sunucu olmadan botlara karşı oynanır; çevrimiçi oynamak için menüdeki
  **Bağlan** alanına sunucu adresini yaz.
- Elle derlemek için: Android Studio + JDK 21 kurulu bir bilgisayarda iş
  akışındaki adımları (`npx cap add android`, `python3 tools/android-prepare.py`,
  `./gradlew assembleDebug`) sırayla çalıştır.

## Faydalı adresler

| Adres | Ne işe yarar |
|---|---|
| `/` | Oyun |
| `/?room=kod` | Özel oda (menüde "Özel oda oluştur") |
| `/status` | Sunucu durumu: harita, oyuncular, kalan süre |
| `/healthz` | İzleme için JSON sağlık kontrolü |

## Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `PORT` | `1138` | Port |
| `ADMIN_PASSWORD` | – | `!login <şifre>` ile uzaktan admin |
| `LAN_ADMIN` | açık (Docker'da `0`) | Aynı ağdan doğrudan bağlananları admin say |
| `TRUST_PROXY` | kapalı | nginx/Render vb. arkasında `1` yap |
| `ROUND_SECONDS` | `300` | Tur süresi |
| `MAX_PLAYERS` | `16` | Oda başına oyuncu |
| `MAX_CONNECTIONS_PER_IP` | `32` | IP başına eşzamanlı bağlantı |
| `BANS_FILE` | – | Ban listesinin saklanacağı JSON dosyası |
| `CORS_ORIGIN` | herkes | Başka sitelerden bağlantıyı kısıtlamak için |
