# FilmLog — GDGoC Backend Recruitment Task Starter Pack

Selamat datang di repositori penugasan backend **FilmLog (Movie Watchlist & Review Platform)**. Repositori ini menyediakan:
1. **Initial Seed Database** (`data/movies.json` dan `data/seed.sql`) berisi 20 film kurasi awal dengan atribut lengkap.
2. **Frontend Companion** (`frontend/`) bertema Letterboxd yang siap pakai untuk menguji endpoint backend Anda secara visual dan interaktif.

---

## 🎯 Objektif Penugasan
Rancang dan bangun layanan **RESTful API** untuk aplikasi pelacak film (*movie watchlist*) yang mendukung alur autentikasi, kurasi film, pencatatan tontonan dan ulasan, serta integrasi **Google Gemini LLM** untuk rekomendasi film berbasis data lokal.

Bebas menggunakan bahasa pemrograman dan framework apa pun (Node.js/Express/NestJS, Go/Gin/Fiber, Python/FastAPI/Django, PHP/Laravel, Java/Spring Boot, dll.) serta database relasional (PostgreSQL, MySQL, SQLite) atau NoSQL.

---

## 📁 Struktur Repositori Starter

```text
movie-watchlist-starter/
├── data/
│   ├── movies.json     # Data 20 film awal (format JSON) untuk database seeder
│   └── seed.sql        # Skrip SQL INSERT kompatibel dengan PostgreSQL & MySQL
├── frontend/
│   ├── index.html      # Frontend Letterboxd-style SPA (Zero-build Tailwind)
│   ├── app.js          # Client logic & API caller
│   └── README.md       # Panduan menjalankan frontend
└── README.md           # Panduan penugasan & spesifikasi API
```

---

## 📑 Spesifikasi Kontrak API (API Contract)

Agar sistem dapat terhubung secara lancar dengan frontend companion yang disediakan, pastikan API Anda mematuhi spesifikasi antarmuka (API Contract) berikut:

### 1. Autentikasi
* `POST /api/auth/register`
  * **Body:** `{ "username": "string", "email": "string", "password": "string" }`
  * **Response:** Status `201 Created`
* `POST /api/auth/login`
  * **Body:** `{ "email": "string", "password": "string" }`
  * **Response:** Status `200 OK`, JSON berisi `{ "token": "JWT_STRING", "user": { ... } }`

### 2. Movies
* `GET /api/movies`
  * **Query Params (Opsional):** `?genre=Sci-Fi&search=Inception`
  * **Response:** Status `200 OK`, array daftar film dari database.
* `GET /api/movies/:id`
  * **Response:** Status `200 OK`, detail lengkap satu film.

### 3. Watchlist (Protected - Membutuhkan `Authorization: Bearer <token>`)
* `GET /api/watchlist`
  * **Response:** Status `200 OK`, daftar film di watchlist user yang sedang login.
* `POST /api/watchlist`
  * **Body:** `{ "movieId": 1 }`
  * **Response:** Status `201 Created`
* `DELETE /api/watchlist/:movieId`
  * **Response:** Status `200 OK` (atau `204 No Content`)

### 4. Watched & Review (Protected - Membutuhkan `Authorization: Bearer <token>`)
* `GET /api/watched`
  * **Response:** Status `200 OK`, riwayat film yang sudah ditonton oleh user beserta ulasan dan ratingnya.
* `POST /api/watched`
  * **Body:** `{ "movieId": 1, "rating": 5, "review": "Filmnya luar biasa..." }`
  * **Response:** Status `201 Created`.

### 5. AI Recommendation (Gemini API Integration ⭐)
* `POST /api/movies/recommend`
  * **Body:** `{ "prompt": "Saya mau film misteri dengan alur lambat dan atmosfer mendalam" }`
  * **Aturan Khusus:** Film yang direkomendasikan **harus berasal dari 20 film di database awal**.
  * **Response:** Status `200 OK` dengan JSON terstruktur:
    ```json
    {
      "movie_id": 14,
      "reasoning": "Memento sangat cocok dengan preferensi misteri Anda karena..."
    }
    ```

---

## 🚀 Menjalankan Proyek

```bash
npm install
cp .env.example .env     # isi DATABASE_URL, JWT_SECRET, GEMINI_API_KEY

npm run db:push          # sinkronkan schema Prisma
npm run db:seed          # masukkan 20 film dari data/movies.json

npm run dev              # http://localhost:8000/api
```

Perintah lain:

| Perintah | Fungsi |
|---|---|
| `npm run build` | Kompilasi TypeScript ke `dist/` |
| `npm start` | Jalankan hasil build (`dist/server.js`) |
| `npm run typecheck` | Typecheck `src/`, `prisma/seed.ts`, dan `tests/` |
| `npm run db:seed` | Idempoten (upsert), aman dijalankan berulang |

---

## 🧪 Pengujian Otomatis

```bash
npm test           # seluruh suite (unit + integration)
npm run test:unit  # hanya unit test (tidak menyentuh database)
```

`npm test` menjalankan `scripts/run-tests.mjs`, yang:

1. membuat ulang database **khusus test** `<nama_db>_test` (default `watchlist_test`) —
   database development tidak pernah disentuh;
2. menerapkan schema dengan `prisma db push` dan menjalankan seed asli;
3. menjalankan `node:test` lewat `tsx` (tanpa dependency tambahan).

Yang diuji: validator, pemetaan error → status code, autentikasi/JWT, isolasi data
antar user, watchlist, review, dan matriks status code.

---

## 📊 Matriks Status Code

| Status | Kapan dipakai |
|---|---|
| `200` | Login, daftar/detail film, daftar watchlist & watched |
| `201` | Register, tambah watchlist, tambah/update review |
| `204` | Hapus watchlist / review berhasil |
| `400` | Body/query/param tidak valid, JSON rusak, ID bukan angka/UUID |
| `401` | Token tidak ada/kadaluarsa/invalid, kredensial salah |
| `403` | Terautentikasi tetapi bukan pemilik resource |
| `404` | Film / watchlist / review tidak ditemukan |
| `409` | Email sudah dipakai, film sudah ada di watchlist |
| `413` | Body melebihi batas 100kb |
| `422` | AI memilih film di luar katalog (input valid, tidak dapat diproses) |
| `502`/`503` | Kegagalan layanan AI (termasuk rate limit) / database tidak tersedia |

---

## 💡 Prinsip Backend yang Dinilai
1. **Database Modeling:** Relasi yang rapi antar tabel (`users`, `movies`, `watchlists`, `reviews`).
2. **Access Control & Security:** Password di-hash (bcrypt/argon2), rute privat terlindungi token JWT, user tidak dapat memodifikasi data user lain.
3. **Data Integrity & Robustness:** Validasi input request, penanganan error yang baik, dan penggunaan status code HTTP yang semantik.
4. **Structured LLM Prompting:** Kemampuan mengarahkan Gemini untuk memilih dari subset data lokal dan mengembalikan JSON terstruktur.
