import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { GAYA, KAMERA_FOKUS_TUGAS, KAMERA_STATIS, KANTOR, LAPORAN, MODE_TUGAS, TAMPIL_PEMILIH_GAYA } from './config';
import { DAFTAR_GAYA, KUNCI_SIMPAN, cariGaya, gayaAwal, type GayaId } from './gaya/daftar';
import { IDLE_LABEL, idleAt, isNight, isoDay, lapseAt, missionBoard, officeDesks, params as readParams, type DeskState, type IdleSpot } from './office';

import Panel, { type Kerja } from './Panel';
import Aksi from './Aksi';
import Pengaman from './Pengaman';
const OfficeScene = lazy(() => import('./OfficeScene'));

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export default function App() {
  const p = useMemo(() => readParams(new URLSearchParams(location.search)), []);
  const [now, setNow] = useState(() => new Date());
  const [t, setT] = useState(0);
  const [openRaw, setOpen] = useState<DeskState | null>(null);
  const [boardBuka, setBoardBuka] = useState(true);
  const drive = useRef<((t: number) => void) | null>(null);
  const anchors = useRef(new Map<string, HTMLElement>());
  const boardAnchor = useRef<HTMLElement | null>(null);
  const [gaya, setGaya] = useState<GayaId>(() => {
    let simpanan: string | null = null;
    try {
      simpanan = localStorage.getItem(KUNCI_SIMPAN);
    } catch {
      /* penyimpanan diblokir: pakai config */
    }
    return gayaAwal(new URLSearchParams(location.search).get('gaya'), simpanan, GAYA);
  });
  const [pilihBuka, setPilihBuka] = useState(false);
  const gantiGaya = (id: GayaId) => {
    setGaya(id);
    setPilihBuka(false);
    try {
      localStorage.setItem(KUNCI_SIMPAN, id);
    } catch {
      /* abaikan */
    }
    const q = new URLSearchParams(location.search);
    q.set('gaya', id);
    history.replaceState(null, '', `${location.pathname}?${q}`);
  };
  const g = cariGaya(gaya);

  // Progres tugas dari server agent: agent yang sedang mengerjakan tugas bos duduk bekerja dan kamera mengarah ke dia.
  const [kerja, setKerja] = useState<Kerja | null>(null);
  useEffect(() => {
    if (p.rec) return;
    let stop = false;
    let id = 0;
    const tick = async () => {
      let d: Kerja | null = null;
      try {
        const r = await fetch('/api/progres');
        d = r.ok ? await r.json() : null;
      } catch {
        d = null;
      }
      if (stop) return;
      setKerja(d);
      id = window.setTimeout(tick, d ? (d.aktif ? 1000 : 2500) : 15000);
    };
    void tick();
    return () => {
      stop = true;
      window.clearTimeout(id);
    };
  }, [p.rec]);
  const fokus = kerja?.aktif ? kerja.agen : null;

  // Laporan agent diambil dari server (bukan impor yang memuat ulang halaman), supaya popup dan chat tidak tertutup.
  const laporanTerakhir = useRef('');
  const muatLaporan = useCallback(async () => {
    try {
      const r = await fetch('/api/laporan');
      if (!r.ok) return;
      const teks = await r.text();
      if (teks === laporanTerakhir.current) return;
      laporanTerakhir.current = teks;
      for (const k of Object.keys(LAPORAN)) delete LAPORAN[k];
      Object.assign(LAPORAN, JSON.parse(teks));
    } catch {
      /* server belum jalan: pakai data bawaan */
    }
  }, []);
  useEffect(() => {
    if (p.rec) return;
    void muatLaporan();
    const id = window.setInterval(() => void muatLaporan(), 2000);
    return () => window.clearInterval(id);
  }, [p.rec, muatLaporan]);

  // Scene time (agents walking, bubbles) and, with ?timelapse=1, the office clock. ?rekam=1: window.__koFrame(t).
  useEffect(() => {
    if (p.rec) {
      const w = window as unknown as { __koFrame?: (t: number) => boolean };
      w.__koFrame = (x: number) => {
        flushSync(() => setT(x));
        drive.current?.(x);
        return !!drive.current;
      };
      return () => void delete w.__koFrame;
    }
    const start = performance.now();
    const id = window.setInterval(() => {
      setT((performance.now() - start) / 1000);
      setNow(new Date());
    }, 100);
    return () => window.clearInterval(id);
  }, [p.rec]);

  const lapse = p.lapse ? lapseAt(t) : null;
  const time = lapse?.time ?? p.time ?? hm(now);
  // Trigger tugas: tanpa tugas agent jalan-jalan, dapat tugas langsung duduk di depan laptop.
  const modeTugas = MODE_TUGAS && !p.lapse && !p.rec && !p.time;
  const statusTugas = new Map((kerja?.aktif ? kerja.rencana : []).map((r) => [r.agen, r.status]));
  const desks = officeDesks(isoDay(now), time, p.alwaysWork).map((d): DeskState => {
    const st = d.desk.key === fokus ? 'kerja' : statusTugas.get(d.desk.key);
    if (st === 'kerja') return { ...d, doing: { activity: 'kerja', label: 'mengerjakan tugas bos…' } };
    if (!modeTugas) return d;
    if (st === 'antri') return { ...d, doing: { activity: 'kerja', label: 'menunggu giliran…' } };
    if (st === 'selesai') return { ...d, doing: { activity: 'laporan', label: 'tugas selesai ✓' } };
    return { ...d, doing: { activity: 'siaga', label: 'siap menerima perintah' } };
  });
  const open = openRaw ? (desks.find((x) => x.desk.key === openRaw.desk.key) ?? null) : null;
  const board = missionBoard(desks);
  const night = isNight(time);
  const withBubble = desks.filter((d) => d.bubble);
  const spotKey = withBubble.length ? withBubble[Math.floor(t / 2.5) % withBubble.length]!.desk.key : null;
  const working = desks.filter((d) => ['kerja', 'laporan', 'belajar'].includes(d.doing.activity)).length;
  const idle = desks.filter((d) => d.doing.activity === 'siaga').length;
  const latar = g.latar && (night ? g.latar.malam : g.latar.siang);

  return (
    <div className="ko" data-night={night || !!g.malam || undefined} data-gaya={gaya} style={latar ? { background: latar } : undefined}>
      <div className="ko-stage">
        <Suspense fallback={<div className="ko-loading">Menyiapkan kantor…</div>}>
          <OfficeScene
            desks={desks}
            night={night}
            boardCount={Math.min(board.items.length, 8)}
            anchors={anchors}
            boardAnchor={boardAnchor}
            cinematic
            manual={p.rec}
            drive={drive}
            gaya={gaya}
            fokus={KAMERA_FOKUS_TUGAS ? fokus : null}
            statis={KAMERA_STATIS && !p.rec}
          />
        </Suspense>
        {g.tiltShift && <div className="ko-tilt" aria-hidden="true" />}
        <div className="ko-layer">
          {desks.map((d) => (
            <Tag
              key={d.desk.key}
              d={d}
              spot={spotKey === d.desk.key}
              idle={d.doing.activity === 'siaga' ? idleAt(d.desk.key, t).spot : null}
              refFn={(el) => (el ? anchors.current.set(d.desk.key, el) : anchors.current.delete(d.desk.key))}
              onOpen={() => setOpen(d)}
            />
          ))}
          <span className="ko-board-pin" ref={(el) => void (boardAnchor.current = el)}>
            Mission Board
          </span>
        </div>
      </div>

      <header className="ko-hud">
        <div className="ko-brand">
          <span className="ko-live" />
          <div>
            <b>{KANTOR.nama}</b>
            <small>
              {KANTOR.subjudul} · {working} bekerja · {idle} santai · {board.items.length} misi
            </small>
          </div>
        </div>
        <div className="ko-clock">
          <b>{time.replace(':', '.')}</b>
          <small>
            {HARI[now.getDay()]}, {now.getDate()} {BULAN[now.getMonth()]} {now.getFullYear()}
          </small>
        </div>
      </header>

      {lapse && (!p.rec || lapse.inAct < 3) && (
        <p key={lapse.act} className="ko-act" style={p.rec ? { animation: 'none', opacity: Math.max(0, Math.min(1, lapse.inAct * 3, (3 - lapse.inAct) * 2)) } : undefined}>
          {lapse.title}
        </p>
      )}

      {boardBuka ? <aside className="ko-mini">
        <div className="ko-mini-head">
          <span className="ko-mini-mark" aria-hidden="true">✦</span>
          <div><h2>Mission Board</h2><small>Ringkasan aktivitas tim</small></div>
          <span className="ko-mini-count">{board.items.length} misi</span>
          <button type="button" className="ko-board-toggle" aria-label="Tutup Mission Board" title="Tutup Mission Board" onClick={() => setBoardBuka(false)}>−</button>
        </div>
        <ul>
          {board.items.slice(0, 3).map((it, i) => (
            <li key={i} style={{ ['--agent' as string]: it.color }}>
              <span className="ko-mini-agent">{it.name}</span><span>{it.text}</span>
            </li>
          ))}
        </ul>
        {board.items.length === 0 && <p className="ko-mini-empty">Belum ada misi baru. Tim siap menerima tugas.</p>}
        {board.metrics.length > 0 && (
          <dl>
            {board.metrics.slice(0, 4).map((m, i) => (
              <div key={i}>
                <dd title={m.nilai}>{m.nilai.replace(/\s*\([^)]*$/, '').trim()}</dd>
                <dt>{m.label}</dt>
              </div>
            ))}
          </dl>
        )}
      </aside> : (
        <button type="button" className="ko-board-open" onClick={() => setBoardBuka(true)} aria-label="Buka Mission Board">
          <span aria-hidden="true">✦</span><b>Mission Board</b><small>{board.items.length}</small>
        </button>
      )}

      {TAMPIL_PEMILIH_GAYA && !p.rec && (
        <nav className="ko-gaya" aria-label="Gaya 3D">
          {pilihBuka && (
            <ul>
              {DAFTAR_GAYA.map((x) => (
                <li key={x.id}>
                  <button type="button" aria-pressed={x.id === gaya} title={x.ket} onClick={() => gantiGaya(x.id as GayaId)}>
                    {x.nama}
                    {x.jenis === 'paduan' && <small>dunia</small>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="ko-gaya-btn" aria-expanded={pilihBuka} onClick={() => setPilihBuka((b) => !b)}>
            Gaya: {g.nama}
          </button>
        </nav>
      )}

      {!p.rec && (
        <Pengaman nama="Panel tugas">
          <Panel kerja={kerja} />
        </Pengaman>
      )}

      {open && (
        <div className="ko-sheet" role="dialog" aria-label={open.agen.nama} onClick={() => setOpen(null)}>
          <div className="ko-sheet-in" onClick={(e) => e.stopPropagation()}>
            <h3>
              <span className="ko-sheet-avatar" style={{ ['--agent' as string]: open.desk.color }}>{open.agen.nama.slice(0, 1)}</span>
              <span>{open.agen.nama} <small>{open.agen.tugas}</small></span>
            </h3>
            <p className="ko-sheet-status"><span />{open.doing.label}</p>
            <section className="ko-agent-detail">
              <h4><span>01</span> Tugas utama</h4>
              <p>{kerja?.rencana.find((r) => r.agen === open.agen.key)?.tugas ?? open.agen.rincianTugas}</p>
              <h4><span>02</span> Keahlian</h4>
              <ul>
                {open.agen.keahlian.map((skill) => <li key={skill}><span>✦</span>{skill}</li>)}
              </ul>
            </section>
            <Pengaman nama="Hasil agent">
              <Aksi agen={open.agen.key} />
            </Pengaman>
            <button type="button" onClick={() => setOpen(null)}>
              Tutup
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Tag({ d, spot, idle, refFn, onOpen }: { d: DeskState; spot: boolean; idle: IdleSpot | null; refFn: (el: HTMLElement | null) => void; onOpen: () => void }) {
  const label = idle ? IDLE_LABEL[idle] : d.doing.label;
  const a = d.doing.activity;
  const think = a === 'kerja' ? '</>' : a === 'laporan' ? '•••' : a === 'belajar' ? '📖' : idle === 'kopi' ? '☕' : idle === 'papan' ? '📌' : idle === 'sofa' ? '💬' : null;
  return (
    <div className="ko-tag" ref={refFn} data-act={a} style={{ ['--agent' as string]: d.desk.color }}>
      <div className="ko-tag-in">
        {d.bubble && spot && a !== 'pulang' && <p className="ko-bubble">{d.bubble}</p>}
        {think && !(d.bubble && spot) && <span className="ko-think">{think}</span>}
        <div className="ko-tag-row">
          <button type="button" className="ko-name" onClick={onOpen}>
            <span className="ko-dot" />
            {d.agen.nama}
            <span className="ko-role">{d.agen.tugas}</span>
            <span className="ko-name-act">{label}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
