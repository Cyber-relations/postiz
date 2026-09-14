// Public build metadata; never accept a destination from the request.
export function GET() {
  const revision = process.env.NEXT_PUBLIC_VERSION || '';
  if (!/^[0-9a-f]{40}$/.test(revision)) {
    return new Response('対応ソースを確認できません。時間をおいて再度お試しください。', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  return new Response(null, { status: 302, headers: {
    Location: `https://github.com/Cyber-relations/postiz/tree/${revision}`,
    'Cache-Control': 'no-store',
  } });
}
