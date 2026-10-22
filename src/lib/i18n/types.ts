import type {LandingCopy} from './landing-copy';

export type Dictionary = {
  siteTitle: string;
  siteDescription: string;
  chatNow: string;
  signIn: string;
  exploreHeadline: (count: string) => string;
  exploreSubhead: string;
  charactersSection: string;
  aboutTitle: string;
  aboutHeading: string;
  aboutBody: string[];
  termsTitle: string;
  termsHeading: string;
  characterTitleSuffix: string;
  chatsLabel: string;
  conversationsLabel: string;
  prevBanner: string;
  nextBanner: string;
  goToBanner: (n: number) => string;
  bannerNav: string;
  notFound: string;
  /** The combined sign-in / sign-up page at /{locale}/auth. */
  authTitle: string;
  authHeading: string;
  authSubhead: string;
  signUp: string;
  emailLabel: string;
  passwordLabel: string;
  displayNameLabel: string;
  authSwitchToSignUp: string;
  authSwitchToSignIn: string;
  authSubmitting: string;
  authGenericError: string;
  landing: LandingCopy;
};
