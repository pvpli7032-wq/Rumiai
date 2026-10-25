import {listCharacters} from '@rumiai/backend/modules/characters/catalog-service';
import {readPublicSiteContent} from '@rumiai/backend/modules/site-content/public-service';
import {readSettingValue} from '@rumiai/backend/modules/settings/index';

/** Published CMS sections and live character rules; UI only renders this projection. */
export async function readDiscoverProjection() {
  const [site, railLimit, strategy] = await Promise.all([
    readPublicSiteContent(), readSettingValue<number>('discovery.railLimit'),
    readSettingValue<string>('discovery.recommendationStrategy'),
  ]);
  const [hot, newest, exclusive] = await Promise.all([
    listCharacters({sort: 'popular', limit: railLimit}),
    listCharacters({sort: 'new', limit: railLimit}),
    strategy === 'EXCLUSIVE_FIRST' ? listCharacters({sort: 'popular', exclusive: true, limit: railLimit}) : [],
  ]);
  const recommended = [...new Map([...exclusive, ...hot].map(character => [character.id, character])).values()].slice(0, railLimit);
  const rails = await Promise.all(site.sections.map(async section => ({
    key: section.key,
    items: section.source === 'POPULAR' ? hot : section.source === 'NEWEST' ? newest :
      section.source === 'EXCLUSIVE' ? await listCharacters({sort: 'popular', exclusive: true, limit: railLimit}) :
      section.source === 'TAG' && section.tagKey ? await listCharacters({sort: 'popular', tags: [section.tagKey], limit: railLimit}) : recommended,
  })));
  return {recommended, hot, newest, rails, railLimit};
}
