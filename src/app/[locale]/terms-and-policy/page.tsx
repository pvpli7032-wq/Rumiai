import type { Metadata } from 'next';
import { SITE_URL, alternateLanguages, getDictionary, isLocale, type Locale } from '@/lib/i18n';
import { PublicHeader } from '@/components/public-header';

export async function generateMetadata({ params: paramsPromise }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const params = await paramsPromise;

  if (!isLocale(params.locale)) return {};
  const dict = getDictionary(params.locale);
  return {
    title: dict.termsTitle,
    alternates: {
      canonical: `${SITE_URL}/${params.locale}/terms-and-policy`,
      languages: alternateLanguages('/terms-and-policy'),
    },
  };
}

export default async function TermsPage({ params: paramsPromise }: { params: Promise<{ locale: string }> }) {
  const params = await paramsPromise;

  const locale = (isLocale(params.locale) ? params.locale : 'th') as Locale;
  const dict = getDictionary(locale);

  return (
    <main className="flex min-h-[100svh] flex-col">
      <PublicHeader locale={locale} signInLabel={dict.signIn} />
      <article className="mx-auto w-full max-w-2xl px-6 py-12">
        <h1 className="font-athiti text-3xl font-bold text-white">{dict.termsHeading}</h1>
        {/*
          Placeholder only. The live site's terms and privacy policy are a legal
          document that has to be supplied verbatim — writing substitute wording
          here would misrepresent what users are agreeing to.
        */}
        <p className="mt-6 font-athiti leading-relaxed text-zinc-400">
          当前为内部测试版。注册信息、角色与对话保存在服务器数据库；启用真实 AI 时，上下文发送给配置的模型服务商。真实充值由商户配置与开关控制，默认关闭。隔离开发环境的模拟购买不发生真实扣款。个人页可导出数据或注销；注销清除本人资料和内容，账务、举报证据和其他用户历史按注销说明保留。旧共享文件、备份及供应商数据需运营方核查。请勿上传未经授权素材或敏感个人信息。正式上线前还需补充运营方信息、正式政策、保留期限及未成年人规则。
        </p>
      </article>
    </main>
  );
}
