import type {Metadata} from 'next';
import {OnboardingFlow} from '@/components/growth';

export const metadata: Metadata = {title: '新手引导'};

export default function OnboardingPage() {
  return <OnboardingFlow />;
}
