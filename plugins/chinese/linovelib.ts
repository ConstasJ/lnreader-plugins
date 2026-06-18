import { fetchText } from '@libs/fetch';
import { type Filters, FilterTypes } from '@libs/filterInputs';
import { storage } from '@libs/storage';
import { load as parseHTML } from 'cheerio';
import type { Plugin } from '@/types/plugin';

class Linovelib implements Plugin.PluginBase {
  id = 'linovelib';
  name = 'Linovelib';
  icon = 'src/cn/linovelib/icon.png';
  site = 'https://www.bilinovel.com';
  version = '1.2.3';
  imageRequestInit?: Plugin.ImageRequestInit | undefined = {
    method: 'GET',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 Edg/144.0.0.0',
      Referer: 'https://www.linovelib.com',
      Accept:
        'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    },
  };
  webStorageUtilized = true;
  // The URL of the custom LDS (Linovelib Descramble Server) URL. Due to complex de-scrambling logic, an external LDS is required.
  pluginSettings = {
    host: {
      value: 'http://example.com',
      label: 'Acanthis API Server Host',
      type: 'Text',
    },
  };
  serverUrl = storage.get('host') || 'http://localhost:5301';
  private readonly coverUrlPrefix =
    'https://www.bilinovel.com/files/article/image';

  /** 将封面原始 URL 改写为服务端代理地址 */
  private proxyCoverUrl(originalUrl: string): string {
    let path = originalUrl;
    if (path.startsWith(this.coverUrlPrefix)) {
      path = path.slice(this.coverUrlPrefix.length);
    }
    const qIndex = path.indexOf('?');
    if (qIndex !== -1) {
      path = path.slice(0, qIndex);
    }
    const novelId = path.match(/\/(\d+)\/(\d+)\/(\d+)s\.(jpg|jpeg)/)?.[3];
    return `${this.serverUrl}/v1/linovelib/cover/novel/${novelId}`;
  }

  async popularNovels(
    pageNo: number,
    {
      showLatestNovels,
      filters,
    }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    const rank = showLatestNovels ? 'lastupdate' : filters.rank.value;
    const url = `${this.site}/top/${rank}/${pageNo}.html`;

    const body = await fetchText(url, {
      headers: new Headers({
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Encoding': 'gzip, deflate',
        'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
      }),
    });
    if (body === '') throw Error('无法获取小说列表，请检查网络');

    const loadedCheerio = parseHTML(body);

    const novels: Plugin.NovelItem[] = [];

    loadedCheerio('.module-rank-booklist .book-layout').each((_i, el) => {
      const url = loadedCheerio(el).attr('href');

      const novelName = loadedCheerio(el).find('.book-title').text();
      const novelCover = loadedCheerio(el)
        .find('div.book-cover > img')
        .attr('data-src')
        ?.replace('/https', 'https');
      if (!url) return;

      const novel = {
        name: novelName,
        cover: novelCover ? this.proxyCoverUrl(novelCover) : undefined,
        path: url.replace('.html', ''),
      };

      novels.push(novel);
    });

    return novels;
  }

  async parseNovel(novelId: string): Promise<Plugin.SourceNovel> {
    // move major logic to LDS
    const res = await fetchText(
      `${this.serverUrl}/v1/linovelib/novel/${novelId}`,
    );
    const novel = JSON.parse(res).data as Plugin.SourceNovel;
    return novel;
  }

  async parseChapter(chapterId: string): Promise<string> {
    // move major logic to LDS
    const lastFetchChapterTime =
      Number(storage.get(`lastFetchChapterTime_${chapterId}`)) || 0;
    if (Date.now() - lastFetchChapterTime < 10000) {
      return storage.get(`chapterContent_${chapterId}`) || '';
    }
    const res = await fetchText(
      `${this.serverUrl}/v1/linovelib/chapter/${chapterId}`,
    );
    const resObj = JSON.parse(res).data as { content: string };
    storage.set(`lastFetchChapterTime_${chapterId}`, Date.now());
    storage.set(`chapterContent_${chapterId}`, resObj.content);
    return resObj.content;
  }

  async searchNovels(
    searchTerm: string,
    // pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    // move major logic to LDS
    const lastSearchTime =
      Number(storage.get(`lastSearchTime_${this.id}`)) || 0;
    if (Date.now() - lastSearchTime < 5000) {
      return [];
    }
    const res = await fetchText(
      `${this.serverUrl}/v1/linovelib/search?keyword=${encodeURIComponent(searchTerm)}`,
    );
    const novelsData = JSON.parse(res).data as Plugin.NovelItem[];
    storage.set(`lastSearchTime_${this.id}`, Date.now());
    return novelsData;
  }

  filters = {
    rank: {
      label: '排行榜',
      value: 'monthvisit',
      options: [
        { label: '月点击榜', value: 'monthvisit' },
        { label: '周点击榜', value: 'weekvisit' },
        { label: '月推荐榜', value: 'monthvote' },
        { label: '周推荐榜', value: 'weekvote' },
        { label: '月鲜花榜', value: 'monthflower' },
        { label: '周鲜花榜', value: 'weekflower' },
        { label: '月鸡蛋榜', value: 'monthegg' },
        { label: '周鸡蛋榜', value: 'weekegg' },
        { label: '最近更新', value: 'lastupdate' },
        { label: '最新入库', value: 'postdate' },
        { label: '收藏榜', value: 'goodnum' },
        { label: '新书榜', value: 'newhot' },
      ],
      type: FilterTypes.Picker,
    },
  } satisfies Filters;
}

export default new Linovelib();
