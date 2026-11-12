// Server kecil: terima tugas dari chat -> Gemini membagi ke agent -> tiap agent mengerjakan -> tulis src/laporan.json.
// Jalankan: npm run agen   (butuh GEMINI_API_KEY di file .env)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LAPORAN = path.join(ROOT, 'src', 'laporan.json');
const PORT = Number(process.env.AGEN_PORT || 8787);

// .env sederhana
try {
  for (const baris of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = baris.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {
  /* tidak ada .env */
}

// Mesin utama: Claude Haiku (butuh ANTHROPIC_API_KEY). Gemini dipakai sebagai cadangan kalau Claude gagal atau belum ada key.
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-5-5';
const claude = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

// Model Gemini utama + cadangan. Kuota gratis Gemini dihitung per model per hari, jadi kalau satu habis pindah ke berikutnya.
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const CADANGAN = (process.env.GEMINI_CADANGAN || 'gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3-flash-preview,gemini-2.5-flash-lite')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const MODELS = [...new Set([MODEL, ...CADANGAN])];
const habis = new Map(); // model -> tanggal kuota hariannya habis
let modelTerakhir = claude ? CLAUDE_MODEL : process.env.OPENROUTER_API_KEY ? (process.env.OPENROUTER_MODELS || 'anthropic/claude-haiku-5.5').split(',')[0].trim() : MODEL;

const hariIni = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD, zona waktu lokal

// Catatan pemakaian lokal (dari usageMetadata Gemini), per hari, disimpan di usage.json
const PAKAI = path.join(ROOT, 'usage.json');
let pakai = {};
try {
  pakai = JSON.parse(fs.readFileSync(PAKAI, 'utf8'));
} catch {
  /* mulai kosong */
}
function catat(masuk, keluar) {
  const h = (pakai[hariIni()] ??= { panggilan: 0, masuk: 0, keluar: 0, total: 0 });
  h.panggilan += 1;
  h.masuk += masuk;
  h.keluar += keluar;
  h.total += masuk + keluar;
  try {
    fs.writeFileSync(PAKAI, JSON.stringify(pakai, null, 2));
  } catch {
    /* abaikan */
  }
}
const ringkasPakai = () => {
  const semua = Object.values(pakai);
  const jumlah = (k) => semua.reduce((a, x) => a + x[k], 0);
  return {
    hariIni: pakai[hariIni()] ?? { panggilan: 0, masuk: 0, keluar: 0, total: 0 },
    semua: { panggilan: jumlah('panggilan'), total: jumlah('total') },
    model: modelTerakhir,
    habis: [],
    jumlahModel: 0,
    penyedia: PENYEDIA.map((p) => p.nama).join(' > '),
  };
};

// Agent: key di config.ts -> file definisi + berkas hasil
const AGEN = {
  raka: { md: 'riset.md', berkas: 'riset.md' },
  sekar: { md: 'penulis.md', berkas: 'naskah.md' },
  lita: { md: 'admin.md', berkas: 'jadwal.md' },
};
const URUTAN = ['raka', 'sekar', 'lita'];

const cari = (...p) => [path.join(ROOT, ...p), path.join(ROOT, '..', ...p)].find((x) => fs.existsSync(x));
const baca = (f) => (f ? fs.readFileSync(f, 'utf8') : '');
// Aturan kantor ada di AGENTS.md folder induk (AGENTS.md template ini untuk developer, bukan untuk agent kantor)
const aturan = baca([path.join(ROOT, '..', 'AGENTS.md'), path.join(ROOT, 'AGENTS.md')].find((f) => fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes('laporan.json') && fs.readFileSync(f, 'utf8').includes('Kantor AI ·')));
const definisi = (key) => baca(cari('.agents', 'agents', AGEN[key].md)).replace(/^---[\s\S]*?---\s*/, '');

const tunggu = (ms) => new Promise((ok) => setTimeout(ok, ms));
const pikir = (m) => (m.startsWith('gemini-2.5') ? { thinkingBudget: 0 } : { thinkingLevel: 'minimal' });

async function gemini(system, prompt) {
  const kunci = process.env.GEMINI_API_KEY;
  if (!kunci) throw new Error('GEMINI_API_KEY belum diisi. Buat file .env berisi: GEMINI_API_KEY=kunci_kamu');
  let galat = '';
  for (const m of MODELS) {
    if (habis.get(m) === hariIni()) continue;
    let tanpaPikir = false;
    for (let i = 0; i < 4; i++) {
      const gen = { responseMimeType: 'application/json', temperature: 0.7, ...(tanpaPikir ? {} : { thinkingConfig: pikir(m) }) };
      let r;
      try {
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
          method: 'POST',
          signal: AbortSignal.timeout(90_000),
          headers: { 'content-type': 'application/json', 'x-goog-api-key': kunci },
          body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: gen }),
        });
      } catch (e) {
        galat = `${m}: ${e.message}`;
        await tunggu(1500);
        continue;
      }
      const j = await r.json().catch(() => ({}));
      const pesan = j.error?.message || '';
      if (r.ok) {
        const u = j.usageMetadata ?? {};
        catat(u.promptTokenCount ?? 0, (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0));
        modelTerakhir = m;
        const teks = j.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
        try {
          return JSON.parse(teks);
        } catch {
          galat = `${m}: jawaban bukan JSON`;
          continue;
        }
      }
      galat = `${m} ${r.status}: ${pesan.split('\n')[0]}`;
      if (r.status === 429 && /per ?day/i.test(pesan)) {
        habis.set(m, hariIni()); // kuota harian model ini habis: langsung coba model berikutnya
        console.log(`Kuota harian ${m} habis, pindah ke model cadangan`);
        break;
      }
      if (r.status === 404 || r.status === 403) break; // model tidak tersedia untuk key ini
      if (r.status === 400 && /thinking/i.test(pesan) && !tanpaPikir) {
        tanpaPikir = true;
        continue;
      }
      if (r.status === 429 || r.status >= 500) {
        await tunggu(2000 * (i + 1));
        continue;
      }
      throw new Error(`Gemini ${galat}`);
    }
  }
  if (MODELS.every((m) => habis.get(m) === hariIni())) throw new Error('Kuota gratis harian semua model Gemini sudah habis. Coba lagi besok (reset tengah malam waktu Pasifik, sekitar jam 15.00 WIB) atau aktifkan billing di AI Studio.');
  throw new Error(`Gemini gagal (${galat})`);
}

// ---------- Claude (structured outputs: jawaban dijamin sesuai skema) ----------
const SKEMA = {
  rencana: z.object({
    balasan: z.string(),
    judul: z.string(),
    tugas: z.array(z.object({ agen: z.enum(['raka', 'sekar', 'lita']), tugas: z.string() })),
  }),
  kerja: z.object({
    hasil: z.string(),
    laporan: z.object({
      ringkasan: z.string(),
      menunggu: z.array(z.string()),
      mendesak: z.array(z.string()),
      angka: z.array(z.object({ label: z.string(), nilai: z.string() })),
    }),
  }),
};

async function tanyaClaude(system, prompt, jenis) {
  let r;
  try {
    r = await claude.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      system,
      messages: [{ role: 'user', content: prompt }],
      // effort low: tugas kantor ringan, lebih cepat dan hemat token
      output_config: { effort: 'low', format: zodOutputFormat(SKEMA[jenis]) },
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('ANTHROPIC_API_KEY tidak valid. Cek lagi key di file .env.');
    if (e instanceof Anthropic.PermissionDeniedError) throw new Error('Key Anthropic tidak punya akses ke model ini.');
    if (e instanceof Anthropic.RateLimitError) throw new Error('Terlalu banyak permintaan ke Claude, coba lagi sebentar.');
    if (e instanceof Anthropic.BadRequestError && /credit/i.test(e.message)) throw new Error('Kredit Anthropic habis. Isi saldo di console Anthropic (Plans & Billing).');
    if (e instanceof Anthropic.APIError) throw new Error(`Claude ${e.status ?? ''}: ${e.message}`);
    throw e;
  }
  catat(r.usage?.input_tokens ?? 0, r.usage?.output_tokens ?? 0);
  modelTerakhir = CLAUDE_MODEL;
  if (r.stop_reason === 'refusal') throw new Error('Claude menolak permintaan ini (alasan keamanan).');
  if (r.stop_reason === 'max_tokens') throw new Error('Jawaban Claude terpotong (terlalu panjang).');
  if (!r.parsed_output) throw new Error('Jawaban Claude tidak sesuai format.');
  return r.parsed_output;
}

// ---------- OpenRouter (satu key, banyak model) ----------
const OR_KEY = process.env.OPENROUTER_API_KEY;
// Urutan: Claude Haiku (berbayar, sangat murah) -> model gratis. Ganti lewat OPENROUTER_MODELS di .env (pisahkan koma).
const OR_MODELS = (process.env.OPENROUTER_MODELS || 'anthropic/claude-haiku-5.5,nvidia/nemotron-3.5-super-vl:free,google/gemma-4-31b-it:free,google/gemma-4-26b-a4b-it:free')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const SKEMA_JSON = Object.fromEntries(
  Object.entries(SKEMA).map(([k, v]) => {
    const { $schema, ...s } = z.toJSONSchema(v);
    return [k, s];
  }),
);

/** Ambil objek JSON dari teks model (kadang dibungkus ```json atau ada kalimat pembuka). */
function ambilJSON(teks) {
  const t = String(teks ?? '').trim();
  try {
    return JSON.parse(t);
  } catch {
    /* coba cara lain */
  }
  const pagar = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (pagar) {
    try {
      return JSON.parse(pagar[1]);
    } catch {
      /* lanjut */
    }
  }
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('jawaban bukan JSON');
}

async function tanyaOpenRouter(system, prompt, jenis) {
  let galat = '';
  for (const m of OR_MODELS) {
    if (habis.get(`or:${m}`) === hariIni()) continue;
    let pakaiSkema = true;
    for (let i = 0; i < 3; i++) {
      let r;
      try {
        r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          signal: AbortSignal.timeout(90_000),
          headers: { authorization: `Bearer ${OR_KEY}`, 'content-type': 'application/json', 'x-title': 'Kantor AI' },
          body: JSON.stringify({
            model: m,
            max_tokens: 4000, // dibatasi supaya kredit kecil tetap cukup
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: prompt },
            ],
            ...(pakaiSkema ? { response_format: { type: 'json_schema', json_schema: { name: jenis, strict: true, schema: SKEMA_JSON[jenis] } } } : {}),
          }),
        });
      } catch (e) {
        galat = `${m}: ${e.message}`;
        continue;
      }
      const j = await r.json().catch(() => ({}));
      const pesan = String(j.error?.message ?? '');
      if (r.ok && j.choices?.length) {
        catat(j.usage?.prompt_tokens ?? 0, j.usage?.completion_tokens ?? 0);
        try {
          const obj = ambilJSON(j.choices[0].message?.content);
          modelTerakhir = m;
          return obj;
        } catch (e) {
          galat = `${m}: ${e.message}`;
          pakaiSkema = false;
          continue;
        }
      }
      galat = `${m} ${r.status}: ${pesan.slice(0, 160)}`;
      if (r.status === 402 || (r.status === 429 && /free.*per.?day|daily/i.test(pesan))) {
        habis.set(`or:${m}`, hariIni()); // kredit habis / jatah harian model gratis habis
        console.log(`OpenRouter ${m} tidak bisa dipakai hari ini (${r.status}), coba model berikutnya`);
        break;
      }
      if (r.status === 400 && pakaiSkema) {
        pakaiSkema = false; // model tidak mendukung json_schema: minta JSON lewat prompt saja
        continue;
      }
      if (r.status === 401) throw new Error('OPENROUTER_API_KEY tidak valid. Cek lagi key di file .env.');
      if (r.status === 404) break;
      if (r.status === 429 || r.status >= 500) {
        await tunggu(1500 * (i + 1));
        continue;
      }
      break;
    }
  }
  throw new Error(`OpenRouter gagal (${galat})`);
}

/** Coba penyedia satu per satu: Claude langsung (kalau ada key) -> OpenRouter -> Gemini. */
const PENYEDIA = [
  claude && { nama: 'Claude', fn: tanyaClaude },
  OR_KEY && { nama: 'OpenRouter', fn: tanyaOpenRouter },
  process.env.GEMINI_API_KEY && { nama: 'Gemini', fn: (s, p) => gemini(s, p) },
].filter(Boolean);

async function tanya(system, prompt, jenis) {
  if (!PENYEDIA.length) throw new Error('Belum ada API key. Isi OPENROUTER_API_KEY (atau ANTHROPIC_API_KEY / GEMINI_API_KEY) di file .env.');
  const galat = [];
  for (const p of PENYEDIA) {
    try {
      return await p.fn(system, prompt, jenis);
    } catch (e) {
      galat.push(`${p.nama}: ${e.message}`);
      console.log(`${p.nama} gagal, coba penyedia berikutnya`);
    }
  }
  throw new Error(galat.join(' | '));
}

const strs = (a, n = 5) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x.trim()).slice(0, n).map((x) => x.slice(0, 160)) : []);
function bersihkan(l) {
  const out = { ringkasan: String(l?.ringkasan ?? '').slice(0, 220) };
  const menunggu = strs(l?.menunggu);
  const mendesak = strs(l?.mendesak);
  const angka = Array.isArray(l?.angka)
    ? l.angka.filter((a) => a && a.label && a.nilai).slice(0, 4).map((a) => ({ label: String(a.label).slice(0, 30), nilai: String(a.nilai).slice(0, 30) }))
    : [];
  if (menunggu.length) out.menunggu = menunggu;
  if (mendesak.length) out.mendesak = mendesak;
  if (angka.length) out.angka = angka;
  return out;
}
function simpanLaporan(key, laporan) {
  let semua = {};
  try {
    semua = JSON.parse(fs.readFileSync(LAPORAN, 'utf8'));
  } catch {
    /* mulai kosong */
  }
  semua[key] = laporan; // kunci agent lain tidak disentuh
  fs.writeFileSync(LAPORAN + '.tmp', JSON.stringify(semua, null, 2));
  fs.renameSync(LAPORAN + '.tmp', LAPORAN);
}

const FORMAT = `Balas HANYA JSON: {"hasil":"isi pekerjaanmu dalam markdown (bahasa Indonesia)","laporan":{"ringkasan":"1 kalimat, maks 150 karakter","menunggu":["butir yang butuh keputusan bos"],"mendesak":["butir yang mendesak"],"angka":[{"label":"...","nilai":"..."}]}}.
menunggu/mendesak/angka boleh dihilangkan jika kosong. Jangan tulis nominal uang atau data rahasia. Kamu tidak punya akses internet: jangan mengarang fakta/tautan, tandai asumsi dengan jelas.`;

// ---------- Folder hasil: satu folder per permintaan bos, di hasil/<id>/ ----------
const HASIL = path.join(ROOT, 'hasil');
const ID_FOLDER = /^[0-9]{8}-[0-9]{6}(-[a-z0-9-]{0,40})?$|^lama$/;
const slug = (t) =>
  String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
const stempel = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
const bacaInfo = (id) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(HASIL, id, '_info.json'), 'utf8'));
  } catch {
    return null;
  }
};
const tulisInfo = (info) => {
  fs.mkdirSync(path.join(HASIL, info.id), { recursive: true });
  fs.writeFileSync(path.join(HASIL, info.id, '_info.json'), JSON.stringify(info, null, 2));
};
// Hasil dari sebelum ada folder: jadikan satu folder "Hasil sebelumnya" (sekali saja)
try {
  if (!fs.existsSync(HASIL)) {
    const lama = Object.entries(AGEN).filter(([, a]) => fs.existsSync(path.join(ROOT, a.berkas)));
    if (lama.length) {
      const waktu = new Date(Math.max(...lama.map(([, a]) => fs.statSync(path.join(ROOT, a.berkas)).mtimeMs)));
      const info = { id: 'lama', judul: 'Hasil sebelumnya', pesan: 'Hasil kerja sebelum fitur folder ada', waktu: waktu.toISOString(), tugas: [] };
      for (const [agen, a] of lama) {
        fs.mkdirSync(path.join(HASIL, 'lama'), { recursive: true });
        fs.copyFileSync(path.join(ROOT, a.berkas), path.join(HASIL, 'lama', a.berkas));
        info.tugas.push({ agen, tugas: '', berkas: a.berkas, status: 'selesai' });
      }
      tulisInfo(info);
    }
  }
} catch (e) {
  console.log('Gagal membuat folder hasil lama:', e.message);
}

// Progres tugas yang sedang berjalan (dibaca kantor 3D untuk mengarahkan kamera ke agent yang bekerja)
let progres = { aktif: false, tahap: '', agen: null, rencana: [] };

// Satu permintaan bos = satu sesi. Setiap agent mengerjakan bagiannya, lalu berhenti dan menunggu persetujuan bos
// sebelum agent berikutnya jalan. Tugas baru dari chat membatalkan sesi yang masih menunggu.
let sesi = null; // { id, balasan, folder, antrean: [{agen, tugas}], rencana: [{agen, tugas, status}], konteks: {agen: isi} }
const idle = () => ({ aktif: false, tahap: '', agen: null, rencana: [] });

const respon = (s, hasil) => ({
  sesi: s.antrean.length ? s.id : null,
  balasan: s.balasan,
  judul: s.folder?.judul ?? null,
  folder: s.folder?.id ?? null,
  hasil,
  berikut: s.antrean[0] ?? null,
});

/** Jalankan agent berikutnya di antrean, simpan hasilnya (berkas, folder, laporan). */
async function jalankanBerikut(s) {
  const t = s.antrean.shift();
  const r = s.rencana.find((x) => x.agen === t.agen);
  r.status = 'kerja';
  progres = { aktif: true, tahap: 'mengerjakan tugas bos…', agen: t.agen, rencana: s.rencana };
  const sistem = `${definisi(t.agen)}\n\nAturan kantor:\n${aturan}\n\n${FORMAT}`;
  const ekstra = Object.entries(s.konteks)
    .map(([k, v]) => `\n\nHasil ${k} (rekan timmu):\n${v}`)
    .join('');
  try {
    const out = await tanya(sistem, `Tugas dari bos untukmu: ${t.tugas}\nKerjakan HANYA tugas ini; bagian lain dikerjakan rekan timmu. Tulis di "hasil" isi pekerjaannya saja, tanpa menyebut nama berkas.${ekstra}`, 'kerja');
    const laporan = bersihkan(out.laporan);
    if (!laporan.ringkasan) throw new Error('laporan kosong');
    const isi = String(out.hasil ?? '');
    fs.writeFileSync(path.join(ROOT, AGEN[t.agen].berkas), isi); // salinan terbaru (dipakai popup agent)
    fs.writeFileSync(path.join(HASIL, s.folder.id, AGEN[t.agen].berkas), isi);
    s.folder.tugas.push({ agen: t.agen, tugas: t.tugas, berkas: AGEN[t.agen].berkas, ringkasan: laporan.ringkasan, status: 'selesai' });
    tulisInfo(s.folder);
    simpanLaporan(t.agen, laporan);
    s.konteks[t.agen] = isi.slice(0, 4000);
    r.status = 'selesai';
    return { agen: t.agen, tugas: t.tugas, berkas: AGEN[t.agen].berkas, ringkasan: laporan.ringkasan };
  } catch (e) {
    r.status = 'gagal';
    s.folder.tugas.push({ agen: t.agen, tugas: t.tugas, berkas: null, status: 'gagal', error: String(e.message).slice(0, 200) });
    tulisInfo(s.folder);
    return { agen: t.agen, tugas: t.tugas, error: e.message };
  }
}

async function proses(pesan) {
  sesi = null; // tugas baru membatalkan sesi yang masih menunggu persetujuan
  progres = { aktif: true, tahap: 'Koordinator membagi tugas…', agen: null, rencana: [] };
  try {
    const rencana = await tanya(
      `Kamu koordinator Kantor AI. Agent yang tersedia:\n- raka: riset (cari tren, data, ide)\n- sekar: penulis (naskah, caption, copywriting; memakai hasil riset Raka jika ada)\n- lita: admin (jadwal, daftar persetujuan bos)\nBagi permintaan bos ke agent yang relevan saja (boleh 0 jika cuma ngobrol). Balas HANYA JSON: {"balasan":"jawaban singkat santai bahasa Indonesia untuk bos","judul":"judul singkat permintaan ini, maks 5 kata, tanpa tanda baca","tugas":[{"agen":"raka|sekar|lita","tugas":"instruksi jelas"}]}`,
      pesan,
      'rencana',
    );
    const balasan = String(rencana.balasan ?? 'Siap, bos.');
    const tugas = (Array.isArray(rencana.tugas) ? rencana.tugas : []).filter((t) => AGEN[t?.agen] && t.tugas);
    tugas.sort((a, b) => URUTAN.indexOf(a.agen) - URUTAN.indexOf(b.agen));
    if (!tugas.length) return { sesi: null, balasan, judul: null, folder: null, hasil: [], berikut: null };

    // Satu folder per permintaan
    const judul = String(rencana.judul || pesan).replace(/\s+/g, ' ').trim().slice(0, 60) || 'Tugas';
    const folder = { id: `${stempel()}-${slug(judul)}`.replace(/-$/, ''), judul, pesan: pesan.slice(0, 300), waktu: new Date().toISOString(), tugas: [] };
    tulisInfo(folder);

    const s = {
      id: randomUUID().slice(0, 8),
      balasan,
      folder,
      antrean: tugas.map((t) => ({ agen: t.agen, tugas: t.tugas })),
      rencana: tugas.map((t) => ({ agen: t.agen, tugas: t.tugas, status: 'antri' })),
      konteks: {},
    };
    const entri = await jalankanBerikut(s);
    sesi = s.antrean.length ? s : null;
    return respon(s, [entri]);
  } finally {
    progres = idle();
  }
}

/** Bos menyetujui (lanjut ke agent berikutnya) atau menghentikan sesi. */
async function lanjut(id, aksi) {
  const s = sesi;
  if (!s || s.id !== id) {
    throw Object.assign(new Error('Sesi ini sudah tidak aktif (server di-restart atau kamu sudah kasih tugas baru).'), { kode: 404 });
  }
  if (aksi === 'tolak') {
    s.folder.dihentikan = s.antrean.map((a) => a.agen);
    tulisInfo(s.folder);
    sesi = null;
    return { sesi: null, balasan: s.balasan, judul: s.folder.judul, folder: s.folder.id, hasil: [], berikut: null, dihentikan: true };
  }
  try {
    const entri = await jalankanBerikut(s);
    if (!s.antrean.length) sesi = null;
    return respon(s, [entri]);
  } finally {
    progres = idle();
  }
}

const bacaBody = (req) =>
  new Promise((ok) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      try {
        ok(JSON.parse(b || '{}'));
      } catch {
        ok({});
      }
    });
  });

http
  .createServer(async (req, res) => {
    const kirim = (kode, obj) => {
      res.writeHead(kode, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj));
    };
    const url = new URL(req.url, 'http://x');
    const rute = `${req.method} ${url.pathname}`;
    try {
      if (rute === 'GET /api/progres') return kirim(200, { ...progres, menunggu: sesi?.antrean[0]?.agen ?? null });
      if (rute === 'GET /api/folder') {
        const daftar = fs.existsSync(HASIL)
          ? fs
              .readdirSync(HASIL)
              .filter((id) => ID_FOLDER.test(id))
              .map((id) => bacaInfo(id))
              .filter(Boolean)
              .map((i) => ({ ...i, tugas: (i.tugas || []).map((t) => ({ ...t, ukuran: t.berkas && fs.existsSync(path.join(HASIL, i.id, t.berkas)) ? fs.statSync(path.join(HASIL, i.id, t.berkas)).size : 0 })) }))
              .sort((a, b) => String(b.waktu).localeCompare(String(a.waktu)))
          : [];
        return kirim(200, daftar);
      }
      if (rute === 'GET /api/berkas') {
        const id = url.searchParams.get('id') || '';
        const a = AGEN[url.searchParams.get('agen')];
        const f = a && ID_FOLDER.test(id) ? path.join(HASIL, id, a.berkas) : null;
        if (!f || !fs.existsSync(f)) return kirim(404, { error: 'berkas tidak ada' });
        return kirim(200, { berkas: a.berkas, isi: fs.readFileSync(f, 'utf8'), diubah: fs.statSync(f).mtimeMs });
      }
      if (rute === 'GET /api/laporan') return kirim(200, JSON.parse(fs.readFileSync(LAPORAN, 'utf8')));
      if (rute === 'GET /api/usage') return kirim(200, ringkasPakai());
      if (rute === 'GET /api/status') return kirim(200, { ok: true, kunci: PENYEDIA.length > 0, penyedia: PENYEDIA.map((p) => p.nama), model: modelTerakhir, agen: URUTAN });
      if (rute === 'GET /api/hasil') {
        const a = AGEN[url.searchParams.get('agen')];
        const f = a && path.join(ROOT, a.berkas);
        if (!f || !fs.existsSync(f)) return kirim(404, { error: 'belum ada hasil' });
        return kirim(200, { berkas: a.berkas, isi: fs.readFileSync(f, 'utf8'), diubah: fs.statSync(f).mtimeMs });
      }
      if (rute === 'POST /api/keputusan') {
        const { agen, butir, jenis, aksi } = await bacaBody(req);
        if (!AGEN[agen] || !['menunggu', 'mendesak'].includes(jenis) || !['setuju', 'tolak', 'selesai'].includes(aksi)) return kirim(400, { error: 'permintaan tidak valid' });
        const semua = JSON.parse(fs.readFileSync(LAPORAN, 'utf8'));
        const lap = semua[agen];
        if (!lap?.[jenis]?.includes(butir)) return kirim(404, { error: 'butir tidak ditemukan (mungkin sudah diputuskan)' });
        lap[jenis] = lap[jenis].filter((x) => x !== butir);
        if (!lap[jenis].length) delete lap[jenis];
        // catatan keputusan bos, supaya ada jejaknya
        const log = path.join(ROOT, 'keputusan.json');
        let daftar = [];
        try {
          daftar = JSON.parse(fs.readFileSync(log, 'utf8'));
        } catch {
          /* mulai kosong */
        }
        daftar.push({ waktu: new Date().toISOString(), agen, butir, aksi });
        fs.writeFileSync(log, JSON.stringify(daftar, null, 2));
        simpanLaporan(agen, lap);
        return kirim(200, { ok: true });
      }
      if (rute === 'POST /api/lanjut') {
        if (progres.aktif) return kirim(409, { error: 'Tim masih mengerjakan, tunggu sebentar ya.' });
        const { sesi: id, aksi } = await bacaBody(req);
        if (!['setuju', 'tolak'].includes(aksi)) return kirim(400, { error: 'aksi tidak valid' });
        return kirim(200, await lanjut(String(id), aksi));
      }
      if (rute === 'POST /api/folder/hapus' || rute === 'POST /api/folder/pulihkan') {
        const { id } = await bacaBody(req);
        if (typeof id !== 'string' || !ID_FOLDER.test(id)) return kirim(400, { error: 'id folder tidak valid' });
        const sampah = path.join(HASIL, '.sampah');
        const asal = path.join(HASIL, id);
        const tujuan = path.join(sampah, id);
        if (rute.endsWith('hapus')) {
          if (!fs.existsSync(asal)) return kirim(404, { error: 'folder tidak ada' });
          if (sesi?.folder.id === id) sesi = null; // folder yang sedang menunggu persetujuan ikut dibatalkan
          fs.mkdirSync(sampah, { recursive: true });
          fs.rmSync(tujuan, { recursive: true, force: true });
          fs.renameSync(asal, tujuan); // dipindah dulu ke .sampah supaya bisa diurungkan
          for (const e of fs.readdirSync(sampah)) {
            const p = path.join(sampah, e);
            if (Date.now() - fs.statSync(p).mtimeMs > 24 * 3600 * 1000) fs.rmSync(p, { recursive: true, force: true });
          }
        } else {
          if (!fs.existsSync(tujuan)) return kirim(404, { error: 'folder sudah tidak bisa dipulihkan' });
          if (fs.existsSync(asal)) return kirim(409, { error: 'folder dengan nama itu sudah ada' });
          fs.renameSync(tujuan, asal);
        }
        return kirim(200, { ok: true });
      }
      if (rute === 'POST /api/chat') {
        if (progres.aktif) return kirim(409, { error: 'Tim masih mengerjakan tugas sebelumnya, tunggu sebentar ya.' });
        const { pesan } = await bacaBody(req);
        if (typeof pesan !== 'string' || !pesan.trim()) return kirim(400, { error: 'pesan kosong' });
        return kirim(200, await proses(pesan.slice(0, 2000)));
      }
      kirim(404, { error: 'tidak ditemukan' });
    } catch (e) {
      kirim(e.kode || 500, { error: e.message });
    }
  })
  .listen(PORT, '127.0.0.1', () =>
    console.log(
      `Server agent siap di http://127.0.0.1:${PORT}\n  Urutan penyedia: ${PENYEDIA.map((p) => p.nama).join(' > ') || 'BELUM ADA KEY'}\n  Claude langsung: ${claude ? CLAUDE_MODEL : '-'}\n  OpenRouter: ${OR_KEY ? OR_MODELS.join(' > ') : '-'}\n  Gemini: ${process.env.GEMINI_API_KEY ? MODELS.join(' > ') : '-'}`,
    ),
  );
