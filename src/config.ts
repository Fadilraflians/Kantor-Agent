/**
 * ✏️ UBAH DI SINI: nama kantor, ruangan, agen, jadwal, dan data contoh.
 * Semua yang tampil di kantor diambil dari file ini. Nama dan angka di bawah fiktif.
 */

import laporanAgen from './laporan.json';
import type { GayaId } from './gaya/daftar';

export const KANTOR = {
  nama: 'Kantor AI',
  /** Baris kecil di bawah nama (mis. nama perusahaan). */
  subjudul: 'Perusahaan Contoh',
};

/**
 * Gaya 3D kantor (lihat README, "Ganti gaya 3D"): 'asli' | 'clay' | 'felt' | 'voxel' | 'vinyl' | 'diorama' | 'kayu' |
 * 'stickman' | 'pulau' | 'toko' | 'menara' | 'taman' | 'gedung30' | 'hologram' | 'angkringan' | 'pecellele' | 'bakso'. Bisa ditimpa lewat ?gaya=<id> atau pemilih di layar.
 */
export const GAYA: GayaId = 'asli';
/**
 * true = agent ikut tugas dari chat: tanpa tugas mereka jalan-jalan (ngopi, lihat papan, ngobrol di sofa),
 * begitu dapat tugas langsung duduk di depan laptop. false = ikut JADWAL di bawah.
 * Timelapse (?timelapse=1), rekam, dan ?jam=… selalu memakai JADWAL.
 */
export const MODE_TUGAS = true;
/** true = kamera diam di satu sudut lebar (video rekaman tetap sinematik). false = kamera mengayun dan close-up bergantian. */
export const KAMERA_STATIS = true;
/** true = saat ada tugas, kamera mendekat ke agent yang sedang bekerja (tetap jalan walau KAMERA_STATIS). */
export const KAMERA_FOKUS_TUGAS = false;
/** Tombol pemilih gaya di pojok kanan bawah. false = sembunyikan (mis. untuk video final). */
export const TAMPIL_PEMILIH_GAYA = true;

/** Tiga ruangan dari kiri ke kanan. Lebarnya ikut `x0`–`x1` (meter), lantainya `warna`, karpetnya `karpet`. */
export const RUANGAN = [
  { key: 'bizdev', label: 'Riset', x0: -7, x1: -1.8, warna: '#e9d9c4', karpet: '#e4572e' },
  { key: 'keuangan', label: 'Penulisan', x0: -1.8, x1: 2, warna: '#efe3cf', karpet: '#f2b134' },
  { key: 'studio', label: 'Admin', x0: 2, x1: 7, warna: '#e3d6c6', karpet: '#3a86ff' },
] as const;
export type RoomKey = (typeof RUANGAN)[number]['key'];

export interface Agen {
  key: string;
  nama: string;
  /** Tugasnya, satu baris. */
  tugas: string;
  /** Tugas utama yang biasa dikerjakan. */
  rincianTugas: string;
  /** Keahlian yang dimiliki agent. */
  keahlian: string[];
  ruang: RoomKey;
  /** Warna baju. */
  warna: string;
  /** Posisi meja (x kiri–kanan −7…7, z belakang–depan −3…3). */
  x: number;
  z: number;
}

/** Tiga agen (sama dengan agent di .agents/agents dan server/agen.mjs). Posisi meja jangan bertumpuk. */
export const AGEN: Agen[] = [
  { key: 'raka', nama: 'Raka', tugas: 'Riset tren', rincianTugas: 'Mencari tren AI dan ide topik konten yang sedang ramai.', keahlian: ['Riset tren AI', 'Mencari ide konten', 'Merangkum temuan'], ruang: 'bizdev', warna: '#e4572e', x: -4.4, z: -0.8 },
  { key: 'sekar', nama: 'Sekar', tugas: 'Penulis naskah', rincianTugas: 'Mengubah hasil riset menjadi naskah reels singkat yang siap ditinjau.', keahlian: ['Menulis hook', 'Menyusun naskah reels', 'Menulis caption dan CTA'], ruang: 'keuangan', warna: '#2a9d8f', x: 0.1, z: -0.8 },
  { key: 'lita', nama: 'Lita', tugas: 'Admin & jadwal', rincianTugas: 'Menyusun jadwal posting dan merapikan daftar pekerjaan tim.', keahlian: ['Menyusun jadwal konten', 'Administrasi tugas', 'Membuat checklist publikasi'], ruang: 'studio', warna: '#ff5d8f', x: 4.5, z: -0.8 },
];

export type Aktivitas = 'kerja' | 'laporan' | 'belajar';

/** Jadwal kerja (WIB). `agen: '*'` = semua agen. `hari` 1 = Senin … 7 = Minggu. `menit` = lama tampil. */
export const JADWAL: { agen: string[] | '*'; mulai: string; menit: number; hari: number[]; aktivitas: Aktivitas; label: string }[] = [
  { agen: ['raka'], mulai: '07:57', menit: 30, hari: [1, 2, 3, 4, 5], aktivitas: 'kerja', label: 'riset tren…' },
  { agen: ['sekar'], mulai: '08:05', menit: 30, hari: [1, 2, 3, 4, 5], aktivitas: 'kerja', label: 'menulis naskah…' },
  { agen: ['lita'], mulai: '08:12', menit: 30, hari: [1, 2, 3, 4, 5], aktivitas: 'kerja', label: 'menyusun jadwal…' },
  { agen: '*', mulai: '15:42', menit: 25, hari: [1, 2, 3, 4, 5], aktivitas: 'laporan', label: 'menulis laporan harian…' },
  { agen: '*', mulai: '20:00', menit: 120, hari: [1, 2, 3, 4, 5, 6, 7], aktivitas: 'belajar', label: 'belajar malam…' },
];

/** Jam kantor: di luar jadwal, agen "siap menerima perintah" (atau ngopi, lihat papan, ngobrol). */
export const JAM_KANTOR = { buka: '07:30', tutup: '18:00' };

export interface Laporan {
  /** Ringkasan hari ini (gelembung di atas kepala). */
  ringkasan?: string;
  /** Butir yang menunggu keputusanmu (tanda "!" dan Mission Board). */
  menunggu?: string[];
  /** Butir mendesak (mejanya berkedip). */
  mendesak?: string[];
  /** Angka hari ini (Mission Board). Jangan isi nominal uang kalau videonya mau dibagikan. */
  angka?: { label: string; nilai: string }[];
}

/**
 * Laporan hari ini per agen. Ini data contoh; untuk data asli, isi dari API/JSON agenmu (lihat README, "Sambungkan agen
 * asli").
 */
export const LAPORAN: Record<string, Laporan> = laporanAgen;

/** Timelapse: satu hari dalam tiga babak (detik = lama tiap babak di video). */
export const BABAK = [
  { dari: '07:28', sampai: '08:44', detik: 12, judul: 'Pagi · radar & email' },
  { dari: '15:36', sampai: '16:10', detik: 9, judul: 'Sore · laporan harian' },
  { dari: '19:52', sampai: '20:26', detik: 9, judul: 'Malam · belajar' },
];
