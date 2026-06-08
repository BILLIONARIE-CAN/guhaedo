export default async function handler(req, res) {
  const { code, error } = req.query;

  if (error) {
    return res.redirect('/?kakao_error=' + error);
  }

  if (!code) {
    return res.status(400).json({ error: 'code 없음' });
  }

  try {
    // 카카오 토큰 발급
    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: 'be82d140cac4386ee76d82cc16c65c3e', // REST API 키
        redirect_uri: 'https://guhaedo.kr/kakao-callback',
        code: code,
      }),
    });
    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      return res.redirect('/?kakao_error=token_failed');
    }

    // 카카오 사용자 정보 조회
    const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userData = await userRes.json();

    const kakaoId = userData.id;
    const nickname = userData.kakao_account?.profile?.nickname || '';
    const email = userData.kakao_account?.email || '';
    const profileImg = userData.kakao_account?.profile?.profile_image_url || '';

    // 사용자 정보를 URL 파라미터로 전달 (임시 방식, 추후 DB 연동)
    const params = new URLSearchParams({
      kakao_id: kakaoId,
      nickname: nickname,
      email: email,
      profile_img: profileImg,
      login_type: 'kakao',
    });

    res.redirect(`/?${params.toString()}`);
  } catch (e) {
    res.redirect('/?kakao_error=server_error');
  }
}
