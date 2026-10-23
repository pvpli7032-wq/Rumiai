import type {Metadata} from 'next';
import {MirrorAdmin} from '@admin/components/mirror';

export const metadata: Metadata = {title: '他眼中的你'};

export default function AdminMirrorPage() {
  return <MirrorAdmin />;
}
