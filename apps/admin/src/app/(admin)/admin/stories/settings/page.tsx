import {Suspense} from 'react';
import {SettingsCenter} from '@admin/components/settings/settings-center';
export default function Page(){return <Suspense fallback={<p role="status">正在读取设置…</p>}><SettingsCenter workspace="story"/></Suspense>;}
