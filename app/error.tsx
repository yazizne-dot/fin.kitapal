"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="loading" role="alert">
      <p>Бетті жүктеу мүмкін болмады.</p>
      <button className="primary" onClick={reset}>
        Қайта жүктеу
      </button>
    </main>
  );
}
