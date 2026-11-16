import { expect, it, vi } from 'vitest';
const loading=vi.hoisted(()=>({load:vi.fn()}));
vi.mock('../../src/i18n/resources',()=>({
  getEnglishResources:()=>({}),isEnglish:(language:string)=>language==='en',
  loadLanguageResources:(language:string)=>loading.load(language),
}));
import i18n,{changeLanguageWithResources,i18nReady} from '../../src/i18n';

it('keeps the latest selected language when an older startup bundle finishes later',async()=>{
  await i18nReady;
  let finish!: (resources:Record<string,unknown>)=>void;
  loading.load.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const old=changeLanguageWithResources('ru');
  await changeLanguageWithResources('en');
  finish({});await old;
  expect(i18n.language).toBe('en');
  expect(document.documentElement.lang).toBe('en');
});
