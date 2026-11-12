import { Component, type ReactNode } from 'react';

/** Kalau komponen di dalamnya error, tampilkan kartu kecil, bukan layar putih. */
export default class Pengaman extends Component<{ children: ReactNode; nama: string }, { galat: string | null }> {
  state = { galat: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { galat: e instanceof Error ? e.message : String(e) };
  }
  componentDidCatch(e: unknown) {
    console.error(`[${this.props.nama}]`, e);
  }
  render() {
    if (!this.state.galat) return this.props.children;
    return (
      <div className="ko-galat" role="alert">
        <b>{this.props.nama} lagi bermasalah</b>
        <span>{this.state.galat}</span>
        <button type="button" onClick={() => this.setState({ galat: null })}>
          Coba lagi
        </button>
      </div>
    );
  }
}
