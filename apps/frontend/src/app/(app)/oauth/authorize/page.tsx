'use client';

import { useCallback, useEffect, useState } from 'react';
import { LoadingSurface } from '@gitroom/frontend/components/layout/loading';
import { useSearchParams } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Logo } from '@gitroom/frontend/components/new-layout/logo';

export default function OAuthAuthorizePage() {
  const searchParams = useSearchParams();
  const fetch = useFetch();
  const [appInfo, setAppInfo] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const clientId = searchParams.get('client_id');
  const responseType = searchParams.get('response_type');
  const state = searchParams.get('state');
  const redirectUri = searchParams.get('redirect_uri');
  const codeChallenge = searchParams.get('code_challenge');
  const codeChallengeMethod = searchParams.get('code_challenge_method');

  useEffect(() => {
    if (!clientId || !responseType) {
      setError('接続に必要な情報が不足しています。連携元のサービスからやり直してください。');
      setLoading(false);
      return;
    }
    if (responseType !== 'code') {
      setError('この接続方法には対応していません。連携元のサービスで設定をご確認ください。');
      setLoading(false);
      return;
    }

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: responseType,
      ...(state ? { state } : {}),
      ...(redirectUri ? { redirect_uri: redirectUri } : {}),
      ...(codeChallenge ? { code_challenge: codeChallenge } : {}),
      ...(codeChallengeMethod
        ? { code_challenge_method: codeChallengeMethod }
        : {}),
    });

    fetch(`/oauth/authorize?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.statusCode && data.statusCode >= 400) {
          setError('接続内容を確認できません。連携元のサービスからやり直してください。');
        } else {
          setAppInfo(data);
        }
        setLoading(false);
      })
      .catch(() => {
        setError('接続内容を確認できませんでした。時間をおいて再度お試しください。');
        setLoading(false);
      });
  }, [clientId, responseType, state, redirectUri, codeChallenge, codeChallengeMethod]);

  const handleAction = useCallback(
    async (action: 'approve' | 'deny') => {
      setSubmitting(true);
      try {
        const result = await (
          await fetch('/oauth/authorize', {
            method: 'POST',
            body: JSON.stringify({
              client_id: clientId,
              state,
              action,
              ...(redirectUri ? { redirect_uri: redirectUri } : {}),
              ...(codeChallenge ? { code_challenge: codeChallenge } : {}),
              ...(codeChallengeMethod
                ? { code_challenge_method: codeChallengeMethod }
                : {}),
            }),
          })
        ).json();

        if (result.redirect) {
          window.location.href = result.redirect;
        }
      } catch {
        setError('接続の確認を完了できませんでした。時間をおいて再度お試しください。');
        setSubmitting(false);
      }
    },
    [clientId, state, redirectUri, codeChallenge, codeChallengeMethod]
  );

  if (loading) {
    return <LoadingSurface label="接続内容を確認しています" />;
  }

  if (error) {
    return (
      <div data-toybaco-connection-surface="" className="flex flex-1 items-center justify-center relative overflow-hidden p-[24px]" style={{ color: 'var(--toybaco-ink, var(--color-text, #24303f))', backgroundColor: 'var(--toybaco-surface, var(--new-bgColor, #fcfbf8))' }}>
        <div className="relative z-10 text-center">
          <div className="flex justify-center mb-[24px]">
            <Logo />
          </div>
          <div className="w-[80px] h-[80px] mx-auto mb-[24px] rounded-full bg-red-500/20 flex items-center justify-center">
            <svg
              className="w-[40px] h-[40px] text-red-500"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="text-[20px] font-semibold mb-[12px]">
            接続を確認できません
          </div>
          <div className="text-[16px] text-newTextColor max-w-[400px]">
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (!appInfo) {
    return null;
  }

  return (
    <div data-toybaco-connection-surface="" className="flex flex-1 items-center justify-center relative overflow-hidden p-[24px]" style={{ color: 'var(--toybaco-ink, var(--color-text, #24303f))', backgroundColor: 'var(--toybaco-surface, var(--new-bgColor, #fcfbf8))' }}>

      <div className="relative z-10 w-full max-w-[500px] min-w-0 mx-auto">
        <div className="flex justify-center mb-[32px]">
          <Logo />
        </div>

        <div className="rounded-[12px] p-[20px] sm:p-[28px] flex flex-col gap-[24px] border" style={{ backgroundColor: 'var(--toybaco-surface, var(--new-bgColorInner, #fcfbf8))', borderColor: 'var(--toybaco-hairline, #dce2e8)' }}>
          <div className="flex flex-col items-center gap-[16px]">
            {appInfo.app.picture?.path ? (
              <img
                src={appInfo.app.picture.path}
                alt={appInfo.app.name}
                className="w-[64px] h-[64px] rounded-full object-cover"
              />
            ) : (
              <div className="w-[64px] h-[64px] rounded-full flex items-center justify-center text-[24px] text-newTextColor" style={{ backgroundColor: 'var(--toybaco-paper, var(--new-bgColor, #faf7f2))' }}>
                {appInfo.app.name?.[0]?.toUpperCase() || '?'}
              </div>
            )}
            <h2 className="text-[24px] font-semibold text-center">
              {appInfo.app.name}
            </h2>
            {appInfo.app.description && (
              <div className="text-newTextColor text-center text-[14px]">
                {appInfo.app.description}
              </div>
            )}
          </div>

          <div className="border-t pt-[16px]" style={{ borderColor: 'var(--toybaco-hairline, #dce2e8)' }}>
            <div className="text-[14px] text-newTextColor mb-[12px]">
              このアプリは、あなたのトイバコアカウントへのアクセスを求めています。
              許可すると、次の操作ができるようになります。
            </div>
            <ul className="text-[14px] list-disc list-inside space-y-[4px]">
              <li>連携サービスとチャンネルの情報を利用する</li>
              <li>あなたに代わって投稿を作成・予約する</li>
              <li>投稿の分析情報を読み取る</li>
            </ul>
          </div>

          <div className="flex gap-[12px]">
            <button
              onClick={() => handleAction('approve')}
              disabled={submitting}
              className="flex-1 min-h-[44px] hover:opacity-90 disabled:opacity-50 text-white rounded-[8px] py-[10px] px-[12px] text-[14px] font-semibold transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current" style={{ backgroundColor: '#1f3a5f', outlineColor: 'var(--toybaco-ink, var(--color-text, #24303f))' }}
            >
              接続を許可する
            </button>
            <button
              onClick={() => handleAction('deny')}
              disabled={submitting}
              className="flex-1 min-h-[44px] hover:opacity-80 disabled:opacity-50 rounded-[8px] py-[10px] px-[12px] text-[14px] font-semibold border transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current" style={{ color: 'inherit', backgroundColor: 'transparent', borderColor: 'var(--toybaco-hairline, #dce2e8)' }}
            >
              許可しない
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
