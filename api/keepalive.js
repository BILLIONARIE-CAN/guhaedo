// =============================================================
//  Supabase 킵얼라이브 — 무료 플랜 자동 일시정지(약 7일 무활동) 방지
//  Vercel Cron이 매일 호출 → DB에 가벼운 SELECT 1건 → "활동 중"으로 유지
// =============================================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

module.exports = async (req, res) => {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    res.status(200).json({ ok: false, reason: 'no env' });
    return;
  }
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/apt_transactions?select=ym&limit=1`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    res.status(200).json({ ok: true, status: r.status, at: new Date().toISOString() });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e) });
  }
};
