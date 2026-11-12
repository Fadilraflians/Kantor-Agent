import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AGEN } from './config';
import './panel.css';

/** Progres tugas dari server agent (GET /api/progres). */
export interface Kerja {
  aktif: boolean;
  tahap: string;
  agen: string | null;
  rencana: { agen: string; tugas: string; status: 'antri' | 'kerja' | 'selesai' | 'gagal' }[];
}
interface Hasil { agen: string; tugas: string; berkas?: string; ringkasan?: string; error?: string }
interface Berikut { agen: string; tugas: string }
interface SesiInfo { id: string; berikut: Berikut | null; status: 'menunggu' | 'disetujui' | 'dihentikan' | 'dibatalkan' | 'selesai' }
interface Pesan { dari: 'bos' | 'sistem'; teks: string; hasil?: Hasil[]; waktu?: number; folder?: string | null; sesi?: SesiInfo }
interface TugasFolder { agen: string; tugas: string; berkas?: string | null; ringkasan?: string; status: string; error?: string; ukuran?: number }
interface Folder { id: string; judul: string; pesan: string; waktu: string; tugas: TugasFolder[] }
interface Pakai { hariIni: { panggilan: number; total: number }; semua: { total: number }; model: string; habis?: string[]; jumlahModel?: number; penyedia?: string }
interface Berkas { berkas: string; isi: string; diubah: number }

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
function workbookZip(entries: { name: string; text: string }[]): Blob {
  const enc = new TextEncoder();
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (bytes: Uint8Array) => {
    let c = 0xffffffff;
    for (const b of bytes) c = crcTable[(c ^ b) & 255]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = enc.encode(entry.name);
    const data = enc.encode(entry.text);
    const crc = crc32(data);
    const l = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(l.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true); l.set(name, 30); l.set(data, 30 + name.length);
    local.push(l);
    const c = new Uint8Array(46 + name.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); c.set(name, 46);
    central.push(c);
    offset += l.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  return new Blob([...local.map(u => u.buffer as ArrayBuffer), ...central.map(u => u.buffer as ArrayBuffer), end.buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
function buatExcel(rows: string[][]): Blob {
  const cols = ['A', 'B', 'C', 'D', 'E'];
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews><cols><col min="1" max="1" width="18" customWidth="1"/><col min="2" max="2" width="46" customWidth="1"/><col min="3" max="4" width="20" customWidth="1"/><col min="5" max="5" width="90" customWidth="1"/></cols><sheetData>${rows.map((row, ri) => `<row r="${ri + 1}">${row.map((v, ci) => `<c r="${cols[ci]}${ri + 1}" t="inlineStr"${ri === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData><autoFilter ref="A1:E${rows.length}"/></worksheet>`;
  return workbookZip([
    { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Hasil Tim" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
    { name: 'xl/worksheets/sheet1.xml', text: sheet },
  ]);
}

const KUNCI = 'kantor-ai-chat';
const agenDari = (k: string) => AGEN.find((a) => a.key === k);
const nama = (k: string) => agenDari(k)?.nama ?? k;
const warna = (k: string) => agenDari(k)?.warna ?? '#271b3f';
const tugasAgen = (k: string) => agenDari(k)?.tugas ?? '';
const jam = (ms: number) => new Date(ms).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
/** Ide tugas yang ditawarkan di chat kosong. Tiap chat baru, tiga ide diacak ulang (selalu ada campuran tim, tulis, dan riset/admin). */
const IDE: Record<'tim' | 'riset' | 'tulis' | 'admin', string[]> = {
  tim: [
    'Cari 3 tren AI minggu ini, tulis naskah reels, lalu susun jadwal posting',
    'Riset 2 topik konten tentang produktivitas, tulis 1 naskah dari yang terbaik, lalu jadwalkan posting 3 hari',
    'Cari ide konten edukasi seputar AI untuk pemula, buat caption-nya, lalu susun jadwal minggu depan',
    'Cari tren konten kuliner lokal, tulis naskah reels 30 detik, dan atur jadwal upload-nya',
    'Riset topik yang lagi ramai di LinkedIn, tulis 1 postingan, lalu tentukan jam terbaik untuk posting',
  ],
  riset: [
    'Cari 5 ide konten yang lagi naik minggu ini',
    'Riset 3 kesalahan umum pemula saat memakai AI untuk bekerja',
    'Cari 3 sudut pandang menarik untuk membahas AI di dunia pendidikan',
    'Rangkum 3 tren desain yang lagi ramai dan cocok dijadikan konten',
    'Cari 5 pertanyaan yang sering ditanyakan orang soal membuat konten dengan AI',
  ],
  tulis: [
    'Tulis 5 ide caption untuk produk baru',
    'Tulis naskah reels 40 detik tentang cara hemat waktu dengan AI, lengkap dengan hook dan CTA',
    'Buat 3 pilihan hook pembuka untuk video tentang kebiasaan produktif',
    'Tulis caption Instagram santai untuk promo akhir bulan',
    'Tulis utas singkat (5 poin) tentang tips menulis prompt yang lebih jelas',
  ],
  admin: [
    'Susun daftar hal yang perlu aku setujui minggu ini',
    'Susun jadwal posting 5 hari ke depan, satu konten per hari',
    'Buat checklist persiapan sebelum upload konten',
    'Atur jadwal kerja tim minggu ini supaya tidak bentrok',
    'Susun daftar tugas prioritas hari ini, urut dari yang paling mendesak',
  ],
};
const pilihAcak = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)]!;
/** Tiga ide baru: satu tugas tim lengkap + dua dari kelompok lain, dan nggak sama dengan tiga ide sebelumnya. */
function acakContoh(sebelumnya: string[]): string[] {
  for (let i = 0; i < 20; i++) {
    const lain = (['riset', 'tulis', 'admin'] as ('riset' | 'tulis' | 'admin')[]).sort(() => Math.random() - 0.5).slice(0, 2);
    const hasil = [pilihAcak(IDE.tim), ...lain.map((k) => pilihAcak(IDE[k]))];
    if (!hasil.some((h) => sebelumnya.includes(h))) return hasil;
  }
  return [pilihAcak(IDE.tim), pilihAcak(IDE.riset), pilihAcak(IDE.tulis)];
}
const SARAN_AGEN: Record<string, string> = {
  raka: 'Raka, cari 3 tren topik AI yang lagi ramai minggu ini',
  sekar: 'Sekar, tulis 1 naskah reels pendek lengkap dengan hook dan caption',
  lita: 'Lita, susun jadwal posting minggu ini',
};
const namaModel = (m?: string) => {
  if (!m) return '';
  const via = m.includes('/') ? ' via OpenRouter' : '';
  let n = m.split('/').pop()!.replace(':free', ' (gratis)');
  if (n.startsWith('claude-')) n = n.replace(/^claude-/, 'Claude ').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/-/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return n + via;
};

function Avatar({ k, kecil }: { k: string; kecil?: boolean }) {
  return (
    <span className="ko-ava" data-kecil={kecil ? '1' : undefined} style={{ ['--agent' as string]: k === 'koordinator' ? '#271b3f' : warna(k) }} aria-hidden="true">
      {k === 'koordinator' ? '✦' : nama(k).slice(0, 1)}
    </span>
  );
}

/* ---------- markdown ringan (tanpa HTML mentah) ---------- */
function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') && p.length > 4 ? <strong key={i}>{p.slice(2, -2)}</strong>
    : p.startsWith('`') && p.endsWith('`') && p.length > 2 ? <code key={i}>{p.slice(1, -1)}</code>
    : p.startsWith('*') && p.endsWith('*') && p.length > 2 ? <em key={i}>{p.slice(1, -1)}</em>
    : <Fragment key={i}>{p}</Fragment>,
  );
}
function Md({ teks }: { teks: string }) {
  const out: ReactNode[] = [];
  let list: { ord: boolean; items: ReactNode[] } | null = null;
  const tutup = () => {
    if (list) out.push(list.ord ? <ol key={out.length}>{list.items}</ol> : <ul key={out.length}>{list.items}</ul>);
    list = null;
  };
  for (const raw of teks.split(/\r?\n/)) {
    const l = raw.trimEnd();
    const h = l.match(/^(#{1,4})\s+(.*)/);
    const li = l.match(/^(\s*)([-*•]|\d+[.)])\s+(.*)/);
    if (h) {
      tutup();
      const Tag = (['h3', 'h3', 'h4', 'h5'] as const)[h[1]!.length - 1]!;
      out.push(<Tag key={out.length}>{inline(h[2]!)}</Tag>);
    } else if (li) {
      const ord = /\d/.test(li[2]!);
      if (!list || list.ord !== ord) {
        tutup();
        list = { ord, items: [] };
      }
      list.items.push(<li key={list.items.length} style={{ marginLeft: Math.min(li[1]!.length, 8) * 6 }}>{inline(li[3]!)}</li>);
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) {
      tutup();
      out.push(<hr key={out.length} />);
    } else if (!l.trim()) {
      tutup();
    } else {
      tutup();
      out.push(<p key={out.length}>{inline(l)}</p>);
    }
  }
  tutup();
  return <div className="ko-md">{out}</div>;
}

/* ---------- panel samping: Tugas (chat) + Hasil ---------- */
export default function Panel({ kerja }: { kerja: Kerja | null }) {
  const [buka, setBuka] = useState(false);
  const [tab, setTab] = useState<'tugas' | 'hasil'>('tugas');
  const [teks, setTeks] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState<Pesan[]>(() => {
    try {
      const p = JSON.parse(localStorage.getItem(KUNCI) || '[]');
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  });
  const [pakai, setPakai] = useState<Pakai | null>(null);
  const [daftarAgen, setDaftarAgen] = useState<string[]>(['raka', 'sekar', 'lita']);
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [bukaFolder, setBukaFolder] = useState<string | null>(null);
  const [isi, setIsi] = useState<Berkas | null>(null);
  const [muatIsi, setMuatIsi] = useState(false);
  const [pilih, setPilih] = useState('raka');
  const [baru, setBaru] = useState(0);
  const [disalin, setDisalin] = useState(false);
  const [terhapus, setTerhapus] = useState<Pesan[] | null>(null); // cadangan sementara untuk Urungkan
  const timerUrung = useRef(0);
  const [urungFolder, setUrungFolder] = useState<{ id: string; judul: string } | null>(null);
  const [contoh, setContoh] = useState<string[]>(() => acakContoh([]));
  const timerFolder = useRef(0);
  const ujung = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const muatPakai = useCallback(() => {
    fetch('/api/usage')
      .then((r) => r.json())
      .then((d) => setPakai(d?.hariIni && d?.semua ? d : null))
      .catch(() => setPakai(null));
  }, []);
  const muatFolder = useCallback(() => {
    fetch('/api/folder')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setFolders(Array.isArray(d) ? d : []))
      .catch(() => setFolders([]));
  }, []);

  useEffect(() => {
    fetch('/api/status')
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.agen) && d.agen.length) setDaftarAgen(d.agen);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!buka) return;
    muatPakai();
    muatFolder();
  }, [buka, muatPakai, muatFolder]);
  // Selama tim bekerja dan tab Hasil terbuka, folder baru langsung kelihatan
  useEffect(() => {
    if (!buka || tab !== 'hasil' || !kerja?.aktif) return;
    const id = window.setInterval(muatFolder, 3000);
    return () => window.clearInterval(id);
  }, [buka, tab, kerja?.aktif, muatFolder]);
  // Isi berkas yang sedang dibuka di folder
  useEffect(() => {
    if (!bukaFolder) return;
    let batal = false;
    setMuatIsi(true);
    fetch(`/api/berkas?id=${encodeURIComponent(bukaFolder)}&agen=${pilih}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !batal && setIsi(typeof d?.isi === 'string' ? d : null))
      .catch(() => !batal && setIsi(null))
      .finally(() => !batal && setMuatIsi(false));
    return () => void (batal = true);
  }, [bukaFolder, pilih]);
  useEffect(() => {
    try {
      localStorage.setItem(KUNCI, JSON.stringify(pesan.slice(-40)));
    } catch {
      /* abaikan */
    }
  }, [pesan]);
  useEffect(() => {
    // jangan return hasil scrollIntoView: di Chrome baru nilainya Promise, React mengira itu fungsi cleanup lalu crash
    ujung.current?.scrollIntoView({ block: 'end' });
  }, [pesan, buka, tab, sibuk, kerja?.agen]);

  const kirim = async (isi?: string) => {
    const t = (isi ?? teks).trim();
    if (!t || sibuk) return;
    setTeks('');
    setSibuk(true);
    const waktuBos = Date.now();
    setPesan((p) => [
      // tugas baru membatalkan persetujuan yang masih menggantung
      ...p.map((m) => (m.sesi?.status === 'menunggu' ? { ...m, sesi: { ...m.sesi, status: 'dibatalkan' as const } } : m)),
      { dari: 'bos', teks: t, waktu: waktuBos },
    ]);
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pesan: t }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
      const hasil: Hasil[] = Array.isArray(j.hasil) ? j.hasil : [];
      setPesan((p) => [
        // pesan permintaan ikut ditandai dengan folder hasilnya, supaya bisa diklik
        ...p.map((m) => (m.dari === 'bos' && m.waktu === waktuBos ? { ...m, folder: j.folder ?? null } : m)),
        { dari: 'sistem', teks: String(j.balasan ?? ''), hasil, waktu: Date.now(), folder: j.folder ?? null, sesi: sesiDari(j, hasil) },
      ]);
      if (hasil.some((h) => !h.error)) setBaru((n) => n + 1);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      const mati = m.includes('Failed to fetch') || m.includes('JSON') || m.includes('Unexpected');
      setPesan((p) => [...p, { dari: 'sistem', teks: `⚠ ${mati ? 'Server agent belum jalan. Jalankan: npm run agen' : m}`, waktu: Date.now() }]);
    }
    setSibuk(false);
    muatPakai();
    muatFolder();
  };

  const sesiDari = (j: { sesi?: string | null; berikut?: Berikut | null }, hasil: Hasil[]): SesiInfo | undefined =>
    j.sesi && j.berikut ? { id: j.sesi, berikut: j.berikut, status: 'menunggu' } : hasil.length ? { id: '', berikut: null, status: 'selesai' } : undefined;

  /** Setujui (agent berikutnya jalan) atau hentikan sesi, langsung dari kolom chat. */
  const lanjutSesi = async (m: Pesan, aksi: 'setuju' | 'tolak') => {
    if (!m.sesi || sibuk) return;
    setSibuk(true);
    const tanda = (status: SesiInfo['status']) => setPesan((p) => p.map((x) => (x.dari === 'sistem' && x.waktu === m.waktu && x.sesi ? { ...x, sesi: { ...x.sesi, status } } : x)));
    try {
      const r = await fetch('/api/lanjut', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sesi: m.sesi.id, aksi }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
      if (aksi === 'tolak') {
        tanda('dihentikan');
        setPesan((p) => [...p, { dari: 'sistem', teks: 'Oke, dihentikan di sini. Hasil yang sudah jadi tetap tersimpan di folder.', waktu: Date.now() }]);
      } else {
        tanda('disetujui');
        const hasil: Hasil[] = Array.isArray(j.hasil) ? j.hasil : [];
        const selesai = hasil[0] ? nama(hasil[0].agen) : '';
        const teks = j.berikut ? `${selesai} selesai. Lanjut ke ${nama(j.berikut.agen)}?` : `${selesai} selesai. Semua tugas beres ✓`;
        setPesan((p) => [...p, { dari: 'sistem', teks, hasil, waktu: Date.now(), folder: j.folder ?? null, sesi: sesiDari(j, hasil) }]);
        if (hasil.some((h) => !h.error)) setBaru((n) => n + 1);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const mati = msg.includes('Failed to fetch') || msg.includes('JSON') || msg.includes('Unexpected');
      if (msg.includes('tidak aktif')) tanda('dibatalkan');
      setPesan((p) => [...p, { dari: 'sistem', teks: `⚠ ${mati ? 'Server agent belum jalan. Jalankan: npm run agen' : msg}`, waktu: Date.now() }]);
    }
    setSibuk(false);
    muatPakai();
    muatFolder();
  };

  /** Hapus folder tanpa popup: dipindah ke tempat sampah sementara, bisa diurungkan beberapa detik. */
  const hapusFolder = async (f: Folder) => {
    try {
      const r = await fetch('/api/folder/hapus', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: f.id }) });
      if (!r.ok) return;
      if (bukaFolder === f.id) setBukaFolder(null);
      setUrungFolder({ id: f.id, judul: f.judul });
      window.clearTimeout(timerFolder.current);
      timerFolder.current = window.setTimeout(() => setUrungFolder(null), 8000);
    } catch {
      /* server mati: abaikan */
    }
    muatFolder();
  };
  const pulihkanFolder = async () => {
    if (!urungFolder) return;
    window.clearTimeout(timerFolder.current);
    try {
      await fetch('/api/folder/pulihkan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: urungFolder.id }) });
    } catch {
      /* abaikan */
    }
    setUrungFolder(null);
    muatFolder();
  };

  const hapusChat = () => {
    if (sibuk || !pesan.length) return;
    setTerhapus(pesan);
    setPesan([]);
    setContoh((c) => acakContoh(c)); // chat baru = ide baru
    window.clearTimeout(timerUrung.current);
    timerUrung.current = window.setTimeout(() => setTerhapus(null), 6000);
  };
  const urungkan = () => {
    window.clearTimeout(timerUrung.current);
    if (terhapus) setPesan(terhapus);
    setTerhapus(null);
  };
  const bukaIsiFolder = (f: Folder, agen?: string) => {
    const ada = f.tugas.find((t) => t.berkas && (!agen || t.agen === agen)) ?? f.tugas.find((t) => t.berkas);
    setIsi(null);
    setPilih(ada?.agen ?? agen ?? f.tugas[0]?.agen ?? 'raka');
    setBukaFolder(f.id);
  };
  const lihatHasil = (folderId: string | null | undefined, agen?: string) => {
    setTab('hasil');
    setBaru(0);
    const f = folders?.find((x) => x.id === folderId);
    if (f) bukaIsiFolder(f, agen);
    else {
      setBukaFolder(null);
      muatFolder();
    }
  };
  const beriTugas = (k: string) => {
    setTab('tugas');
    setTeks(SARAN_AGEN[k] ?? `${nama(k)}, `);
    setTimeout(() => input.current?.focus(), 50);
  };
  const salin = async (s: string) => {
    try {
      await navigator.clipboard.writeText(s);
      setDisalin(true);
      setTimeout(() => setDisalin(false), 1500);
    } catch {
      /* clipboard diblokir */
    }
  };
  const unduh = (b: Berkas) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([b.isi], { type: 'text/markdown' }));
    a.download = b.berkas;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const [unduhXlsBusy, setUnduhXlsBusy] = useState(false);
  const unduhExcel = async (f: Folder) => {
    if (unduhXlsBusy) return;
    setUnduhXlsBusy(true);
    try {
      // Ambil isi semua berkas semua agent dalam folder ini
      const baris: string[][] = [['Agent', 'Peran', 'Berkas', 'Ringkasan', 'Isi']];
      for (const t of f.tugas) {
        if (!t.berkas) {
          baris.push([nama(t.agen), tugasAgen(t.agen), '-', t.error ?? 'Gagal', '']);
          continue;
        }
        try {
          const r = await fetch(`/api/berkas?id=${encodeURIComponent(f.id)}&agen=${encodeURIComponent(t.agen)}`);
          const d: Berkas = r.ok ? await r.json() : { berkas: t.berkas, isi: '', diubah: 0 };
          baris.push([nama(t.agen), tugasAgen(t.agen), t.berkas, t.ringkasan ?? '', d.isi]);
        } catch {
          baris.push([nama(t.agen), tugasAgen(t.agen), t.berkas ?? '-', t.ringkasan ?? '', '']);
        }
      }
      const blob = buatExcel(baris);
      const slugJudul = f.judul.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${f.id.slice(0, 15)}-${slugJudul}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setUnduhXlsBusy(false);
    }
  };

  const folderAktif = folders?.find((f) => f.id === bukaFolder) ?? null;
  const tugasAktif = folderAktif?.tugas.find((t) => t.agen === pilih) ?? null;
  const tglFolder = (iso: string) => jam(new Date(iso).getTime());
  const jalan = kerja?.aktif ? kerja : null;
  const mesin = pakai ? namaModel(pakai.model) : '';

  if (!buka)
    return (
      <button type="button" className="ko-dock-btn" onClick={() => {
          if (!pesan.length) setContoh((c) => acakContoh(c)); // buka chat kosong = ide baru
          setBuka(true);
        }}>
        <span className="ko-dock-ava" aria-hidden="true">
          {daftarAgen.slice(0, 3).map((k) => (
            <Avatar key={k} k={k} kecil />
          ))}
        </span>
        Tugas &amp; Hasil
        {(baru > 0 || jalan) && <span className="ko-dock-badge" data-jalan={jalan ? '1' : undefined}>{jalan ? 'kerja' : baru}</span>}
      </button>
    );

  return (
    <aside className="ko-panel" aria-label="Tugas dan hasil kerja">
      <header className="ko-panel-top">
        <div className="ko-panel-judul">
          <span className="ko-dock-ava" aria-hidden="true">
            {daftarAgen.map((k) => (
              <Avatar key={k} k={k} kecil />
            ))}
          </span>
          <div>
            <b>Ruang Kerja Tim</b>
            <small>
              <span className="ko-status" data-on={pakai ? '1' : undefined} />
              {pakai ? `Tersambung · ${mesin}` : 'Server agent belum tersambung'}
            </small>
          </div>
        </div>
        <button type="button" className="ko-ikon" onClick={() => setBuka(false)} aria-label="Tutup panel">
          ✕
        </button>
      </header>
      <div className="ko-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'tugas'} onClick={() => setTab('tugas')}>
          💬 Tugas
        </button>
        <button type="button" role="tab" aria-selected={tab === 'hasil'} onClick={() => { setTab('hasil'); setBaru(0); }}>
          📄 Hasil{baru > 0 && <span className="ko-tab-badge">{baru}</span>}
        </button>
      </div>

      {tab === 'tugas' ? (
        <>
          <div className="ko-panel-bar">
            <span title="Hitungan lokal dari server ini">
              {pakai ? (
                <>
                  Hari ini <b>{pakai.hariIni.panggilan}</b> panggilan · <b>{pakai.hariIni.total.toLocaleString('id-ID')}</b> token
                  {!!pakai.habis?.length && <em> · {pakai.habis.length}/{pakai.jumlahModel} model habis kuota</em>}
                </>
              ) : (
                'Jalankan npm run agen'
              )}
            </span>
            <button type="button" className="ko-link" onClick={hapusChat} disabled={sibuk || !pesan.length}>
              🗑 Hapus chat
            </button>
          </div>

          {terhapus && (
            <div className="ko-urung" role="status">
              <span>Chat dihapus. Hasil kerja agent tetap aman.</span>
              <button type="button" onClick={urungkan}>
                Urungkan
              </button>
            </div>
          )}
          <div className="ko-chat-log">
            {pesan.length === 0 && !sibuk && (
              <div className="ko-sambut">
                <div className="ko-sambut-tim">
                  {daftarAgen.map((k) => (
                    <div key={k}>
                      <Avatar k={k} />
                      <b>{nama(k)}</b>
                      <small>{tugasAgen(k)}</small>
                    </div>
                  ))}
                </div>
                <p>Mau kerjain apa hari ini, bos? Tulis tugasnya, nanti koordinator membagikan ke orang yang tepat.</p>
                <div className="ko-saran">
                  {contoh.map((c) => (
                    <button type="button" key={c} onClick={() => void kirim(c)}>
                      {c}
                      <span aria-hidden="true">→</span>
                    </button>
                  ))}
                  <button type="button" className="ko-saran-ganti" onClick={() => setContoh((c) => acakContoh(c))}>
                    ↻ Ide lain
                  </button>
                </div>
              </div>
            )}
            {pesan.map((m, i) => (
              <div key={i} className="ko-baris" data-dari={m.dari}>
                {m.dari === 'sistem' && <Avatar k="koordinator" />}
                <div
                  className="ko-msg"
                  data-dari={m.dari}
                  data-klik={m.dari === 'bos' && m.folder ? '1' : undefined}
                  role={m.dari === 'bos' && m.folder ? 'button' : undefined}
                  tabIndex={m.dari === 'bos' && m.folder ? 0 : undefined}
                  title={m.dari === 'bos' && m.folder ? 'Buka hasilnya per orang' : undefined}
                  onClick={m.dari === 'bos' && m.folder ? () => lihatHasil(m.folder) : undefined}
                  onKeyDown={m.dari === 'bos' && m.folder ? (e) => (e.key === 'Enter' || e.key === ' ') && lihatHasil(m.folder) : undefined}
                >
                  {m.dari === 'sistem' && <span className="ko-msg-nama">Koordinator</span>}
                  <p>{m.teks}</p>
                  {m.dari === 'bos' && m.folder && <span className="ko-msg-buka">📁 Buka hasil per orang →</span>}
                  {m.hasil?.map((h, j) => (
                    <div key={j} className="ko-msg-hasil" data-err={h.error ? '1' : undefined} style={{ ['--agent' as string]: warna(h.agen) }}>
                      <Avatar k={h.agen} kecil />
                      <div>
                        <b>{nama(h.agen)}</b>
                        <span>{h.error ? `Gagal: ${h.error.split('\n')[0]}` : h.ringkasan}</span>
                        {!h.error && (
                          <button type="button" className="ko-link" onClick={() => lihatHasil(m.folder, h.agen)}>
                            Lihat hasil →
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {m.sesi?.status === 'menunggu' && m.sesi.berikut && (
                    <div className="ko-setuju" style={{ ['--agent' as string]: warna(m.sesi.berikut.agen) }}>
                      <p>
                        Hasil di atas sudah oke? Kalau kamu setuju, lanjut ke <b>{nama(m.sesi.berikut.agen)}</b> ({tugasAgen(m.sesi.berikut.agen).toLowerCase()}).
                      </p>
                      <small>{m.sesi.berikut.tugas}</small>
                      <div className="ko-setuju-aksi">
                        <button type="button" className="ko-setuju-ya" disabled={sibuk} onClick={() => void lanjutSesi(m, 'setuju')}>
                          ✓ Setujui, lanjut ke {nama(m.sesi.berikut.agen)}
                        </button>
                        <button type="button" className="ko-setuju-tidak" disabled={sibuk} onClick={() => void lanjutSesi(m, 'tolak')}>
                          Hentikan
                        </button>
                      </div>
                    </div>
                  )}
                  {m.sesi && m.sesi.status !== 'menunggu' && (
                    <span className="ko-setuju-status" data-status={m.sesi.status}>
                      {{ disetujui: '✓ Kamu setujui, tim lanjut', dihentikan: '■ Kamu hentikan di sini', dibatalkan: '↺ Dibatalkan karena ada tugas baru', selesai: '✓ Semua bagian selesai', menunggu: '' }[m.sesi.status]}
                    </span>
                  )}
                  {m.waktu && <small>{jam(m.waktu)}</small>}
                </div>
              </div>
            ))}
            {sibuk && (
              <div className="ko-baris" data-dari="sistem">
                <Avatar k={jalan?.agen ?? 'koordinator'} />
                <div className="ko-msg ko-progres" data-dari="sistem">
                  <p className="ko-progres-judul">
                    {jalan?.agen ? `${nama(jalan.agen)} ${jalan.tahap}` : jalan?.tahap || 'Mengirim tugas…'}
                    <span className="ko-ketik" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                  </p>
                  {!!jalan?.rencana.length && (
                    <ol>
                      {jalan.rencana.map((r) => (
                        <li key={r.agen} data-status={r.status} style={{ ['--agent' as string]: warna(r.agen) }}>
                          <Avatar k={r.agen} kecil />
                          <span>
                            <b>{nama(r.agen)}</b> {r.tugas}
                          </span>
                          <em>{{ antri: 'antri', kerja: 'bekerja', selesai: '✓ selesai', gagal: '✕ gagal' }[r.status]}</em>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            )}
            <div ref={ujung} />
          </div>

          <form
            className="ko-input"
            onSubmit={(e) => {
              e.preventDefault();
              void kirim();
            }}
          >
            <textarea
              ref={input}
              value={teks}
              rows={1}
              onChange={(e) => setTeks(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void kirim();
                }
              }}
              placeholder={sibuk ? 'Tim lagi bekerja…' : pesan.some((m) => m.sesi?.status === 'menunggu') ? 'Setujui hasil di atas dulu, atau tulis tugas baru…' : 'Tulis tugas untuk tim… (Enter kirim)'}
              disabled={sibuk}
            />
            <button type="submit" disabled={sibuk || !teks.trim()} aria-label="Kirim">
              ➤
            </button>
          </form>
        </>
      ) : !folderAktif ? (
        <div className="ko-folder-daftar">
          {jalan && (
            <div className="ko-folder-jalan">
              <span className="ko-spin" aria-hidden="true" />
              <span>{jalan.agen ? `${nama(jalan.agen)} ${jalan.tahap}` : jalan.tahap || 'Tim lagi bekerja…'}</span>
            </div>
          )}
          {urungFolder && (
            <div className="ko-urung" role="status">
              <span>Folder “{urungFolder.judul}” dihapus.</span>
              <button type="button" onClick={() => void pulihkanFolder()}>
                Urungkan
              </button>
            </div>
          )}
          {folders === null ? (
            <div className="ko-kosong-kartu">
              <span className="ko-spin" aria-hidden="true" />
              <p>Memuat folder…</p>
            </div>
          ) : folders.length === 0 ? (
            <div className="ko-kosong-kartu">
              <span className="ko-folder-ikon" aria-hidden="true">📁</span>
              <b>Belum ada folder hasil</b>
              <p>Setiap kali kamu kasih tugas, hasilnya masuk ke satu folder sendiri di sini, jadi gampang dicari lagi.</p>
              <button type="button" onClick={() => beriTugas(daftarAgen[0] ?? 'raka')}>
                Beri tugas pertama
              </button>
            </div>
          ) : (
            <>
              <p className="ko-folder-judul">
                Folder hasil <b>{folders.length}</b>
              </p>
              {folders.map((f) => (
                <div key={f.id} className="ko-folder-kartu">
                <button type="button" className="ko-folder" onClick={() => bukaIsiFolder(f)}>
                  <span className="ko-folder-ikon" aria-hidden="true">📁</span>
                  <span className="ko-folder-isi">
                    <b>{f.judul}</b>
                    <small>
                      {tglFolder(f.waktu)} · {f.tugas.filter((t) => t.berkas).length} berkas
                    </small>
                    <em>{f.pesan}</em>
                    <span className="ko-folder-berkas">
                      {f.tugas.map((t) => (
                        <span key={t.agen} data-gagal={t.berkas ? undefined : '1'} style={{ ['--agent' as string]: warna(t.agen) }}>
                          <Avatar k={t.agen} kecil />
                          {t.berkas ?? 'gagal'}
                        </span>
                      ))}
                    </span>
                  </span>
                </button>
                <button type="button" className="ko-folder-hapus" aria-label={`Hapus folder ${f.judul}`} title="Hapus folder" onClick={() => void hapusFolder(f)}>
                  🗑
                </button>
                </div>
              ))}
            </>
          )}
        </div>
      ) : (
        <>
          <div className="ko-folder-kepala">
            <button type="button" className="ko-link" onClick={() => setBukaFolder(null)}>
              ← Semua folder
            </button>
            <div>
              <b>📁 {folderAktif.judul}</b>
              <small>{tglFolder(folderAktif.waktu)}</small>
            </div>
            <button
              type="button"
              className="ko-link ko-link-excel"
              disabled={unduhXlsBusy || folderAktif.tugas.length === 0}
              title="Unduh semua hasil tim sebagai Excel"
              onClick={() => void unduhExcel(folderAktif)}
            >
              {unduhXlsBusy ? <span className="ko-spin" aria-hidden="true" style={{ width: 14, height: 14 }} /> : '⬇'} Excel
            </button>
            <button type="button" className="ko-link ko-link-bahaya" onClick={() => void hapusFolder(folderAktif)}>
              🗑 Hapus
            </button>
          </div>
          <div className="ko-chips">
            {folderAktif.tugas.map((t) => (
              <button key={t.agen} type="button" aria-pressed={pilih === t.agen} onClick={() => setPilih(t.agen)} style={{ ['--agent' as string]: warna(t.agen) }}>
                <Avatar k={t.agen} kecil />
                <span>
                  {nama(t.agen)}
                  <small>{t.berkas ?? 'gagal'}</small>
                </span>
              </button>
            ))}
          </div>
          <div className="ko-hasil">
            {tugasAktif?.berkas && isi ? (
              <>
                <div className="ko-hasil-bar">
                  <span>
                    <b>{isi.berkas}</b> · {jam(isi.diubah)}
                  </span>
                  <span>
                    <button type="button" className="ko-link" onClick={() => void salin(isi.isi)}>
                      {disalin ? 'Tersalin ✓' : 'Salin'}
                    </button>
                    <button type="button" className="ko-link" onClick={() => unduh(isi)}>
                      Unduh
                    </button>
                  </span>
                </div>
                {tugasAktif.tugas && <p className="ko-hasil-tugas">Tugas: {tugasAktif.tugas}</p>}
                {isi.isi.trim() ? <Md teks={isi.isi} /> : <p className="ko-kosong-kecil">Berkasnya kosong.</p>}
              </>
            ) : muatIsi ? (
              <div className="ko-kosong-kartu">
                <span className="ko-spin" aria-hidden="true" />
                <p>Memuat berkas…</p>
              </div>
            ) : (
              <div className="ko-kosong-kartu" style={{ ['--agent' as string]: warna(pilih) }}>
                <Avatar k={pilih} />
                <b>{tugasAktif?.error ? `${nama(pilih)} gagal mengerjakan tugas ini` : `${nama(pilih)} nggak punya berkas di folder ini`}</b>
                <p>{tugasAktif?.error ? tugasAktif.error.split('\n')[0] : 'Pilih agent lain di atas.'}</p>
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
