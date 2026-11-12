import { useEffect, useState } from 'react';

/** Tautan untuk melihat hasil kerja agent, bila server menyediakan berkas. */
export default function Aksi({ agen }: { agen: string }) {
  const [hasil, setHasil] = useState<{ berkas: string; isi: string } | null>(null);
  const [lihat, setLihat] = useState(false);

  useEffect(() => {
    let batal = false;
    fetch(`/api/hasil?agen=${agen}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !batal && setHasil(d?.isi ? d : null))
      .catch(() => !batal && setHasil(null));
    return () => void (batal = true);
  }, [agen]);

  if (!hasil) return null;
  return (
    <>
      <button type="button" className="ko-aksi-hasil" onClick={() => setLihat((v) => !v)}>
        {lihat ? 'Sembunyikan hasil' : `Lihat hasil (${hasil.berkas})`}
      </button>
      {lihat && <pre className="ko-aksi-isi">{hasil.isi}</pre>}
    </>
  );
}
