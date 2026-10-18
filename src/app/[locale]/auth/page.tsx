import type { Metadata } from 'next';
import {SITE_URL, alternateLanguages, getDictionary, isLocale, type Locale, DEFAULT_LOCALE} from '@/lib/i18n';
import { PublicHeader } from '@/components/public-header';
import { AuthForm } from './auth-form';

export async function generateMetadata({ params: paramsPromise }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const params = await paramsPromise;

  if (!isLocale(params.locale)) return {};
  const dict = getDictionary(params.locale);
  return {
    title: dict.authTitle,
    description: dict.authSubhead,
    alternates: {
      canonical: `${SITE_URL}/${params.locale}/auth`,
      languages: alternateLanguages('/auth'),
    },
  };
}

/**
 * The live site's combined sign-in / sign-up page. This route used to redirect to /login,
 * which is untranslated — so a reader arriving from a localised call to action lost their
 * language on the way in.
 */
export default async function AuthPage({ params: paramsPromise }: { params: Promise<{ locale: string }> }) {
  const params = await paramsPromise;

  const locale = (isLocale(params.locale) ? params.locale : DEFAULT_LOCALE) as Locale;
  const dict = getDictionary(locale);

  return (
    <main className="flex min-h-[100svh] flex-col bg-zinc-950">
      <PublicHeader locale={locale} signInLabel={dict.signIn} />
      <div className="relative flex flex-1 items-center justify-center px-4 py-12">
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="absolute left-1/3 top-1/3 h-64 w-64 rounded-full bg-purple-600/15 blur-3xl" />
          <div className="absolute bottom-1/3 right-1/3 h-64 w-64 rounded-full bg-pink-600/15 blur-3xl" />
        </div>
        <AuthForm
          copy={{
            heading: dict.authHeading,
            subhead: dict.authSubhead,
            signIn: dict.signIn,
            signUp: dict.signUp,
            emailLabel: dict.emailLabel,
            passwordLabel: dict.passwordLabel,
            displayNameLabel: dict.displayNameLabel,
            switchToSignUp: dict.authSwitchToSignUp,
            switchToSignIn: dict.authSwitchToSignIn,
            submitting: dict.authSubmitting,
            genericError: dict.authGenericError,
          }}
        />
      </div>
    </main>
  );
}
