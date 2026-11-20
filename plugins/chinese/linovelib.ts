import { fetchApi, fetchText } from '@libs/fetch';
import { type Filters, FilterTypes } from '@libs/filterInputs';
import { storage } from '@libs/storage';
import type { Plugin } from '@/types/plugin';

type ApiResponse<T> = {
  code?: number;
  message?: string;
  data?: T;
};

class Linovelib implements Plugin.PluginBase {
  id = 'linovelib';
  name = 'Linovelib';
  icon = 'src/cn/linovelib/icon.png';
  site = 'https://www.linovelib.com';
  version = '1.3.0';
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
  serverUrl = storage.get<string>('host') || 'http://localhost:5301';

  private buildExploreUrl(
    pageNo: number,
    options?: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): string {
    const baseUrl = (this.serverUrl || 'http://localhost:5301').replace(
      /\/+$/,
      '',
    );
    const { showLatestNovels, filters } = options || {};
    if (showLatestNovels) {
      return `${baseUrl}/v1/linovelib/rankings?rank=lastupdate&full=false&page=${pageNo}&style=lnreader`;
    }

    const mode = filters?.mode?.value || 'rankings';
    const rank = filters?.rank?.value || 'monthvisit';
    const sort = filters?.sort?.value || 'lastupdate';
    const region = filters?.region?.value || '0';
    const tag = filters?.tag?.value || '0';
    const progress = filters?.progress?.value || '0';
    const anime = filters?.anime?.value || '0';
    const words = filters?.words?.value || '0';
    const updated = filters?.updated?.value || '0';

    const hasCatalogFilter =
      region !== '0' ||
      tag !== '0' ||
      progress !== '0' ||
      anime !== '0' ||
      words !== '0' ||
      updated !== '0';

    if (mode === 'catalog' || hasCatalogFilter) {
      return `${baseUrl}/v1/linovelib/catalog?sort=${encodeURIComponent(sort)}&region=${encodeURIComponent(region)}&tag=${encodeURIComponent(tag)}&progress=${encodeURIComponent(progress)}&anime=${encodeURIComponent(anime)}&words=${encodeURIComponent(words)}&updated=${encodeURIComponent(updated)}&page=${pageNo}&style=lnreader`;
    }

    // 服务端对 rank=allvisit&full=false 返回 400；插件静态 Picker 在默认模式下强制 full=true
    const isFull = mode === 'rankings_full' || rank === 'allvisit';
    return `${baseUrl}/v1/linovelib/rankings?rank=${encodeURIComponent(rank)}&full=${isFull}&page=${pageNo}&style=lnreader`;
  }

  async popularNovels(
    pageNo: number,
    options: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    const url = this.buildExploreUrl(pageNo, options);
    const res = await fetchApi(url);
    const body = await res.text();
    if (!body) {
      throw new Error(`无法获取小说列表（HTTP ${res.status}）`);
    }

    let parsed: ApiResponse<Plugin.NovelItem[]>;
    try {
      parsed = JSON.parse(body) as ApiResponse<Plugin.NovelItem[]>;
    } catch {
      throw new Error(`服务端返回无效响应（HTTP ${res.status}）`);
    }

    if (parsed.code !== 0) {
      throw new Error(
        parsed.message ||
          `获取小说列表失败（code: ${parsed.code ?? 'unknown'}, HTTP ${res.status}）`,
      );
    }

    if (!res.ok) {
      throw new Error(
        parsed.message || `无法获取小说列表（HTTP ${res.status}）`,
      );
    }

    if (!Array.isArray(parsed.data)) {
      throw new Error('服务端返回的小说列表格式无效');
    }

    return parsed.data;
  }

  async parseNovel(novelId: string): Promise<Plugin.SourceNovel> {
    // move major logic to LDS
    const res = await fetchText(
      `${this.serverUrl}/v1/linovelib/novel/${novelId}?style=lnreader`,
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
      `${this.serverUrl}/v1/linovelib/search?keyword=${encodeURIComponent(searchTerm)}&style=lnreader`,
    );
    const novelsData = JSON.parse(res).data as Plugin.NovelItem[];
    storage.set(`lastSearchTime_${this.id}`, Date.now());
    return novelsData;
  }

  filters = {
    mode: {
      label: '浏览模式',
      value: 'rankings',
      options: [
        { label: '排行榜（全部）', value: 'rankings' },
        { label: '排行榜（完本）', value: 'rankings_full' },
        { label: '书库多维筛选', value: 'catalog' },
      ],
      type: FilterTypes.Picker,
    },
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
        { label: '总点击榜（完本）', value: 'allvisit' },
      ],
      type: FilterTypes.Picker,
    },
    sort: {
      label: '书库排序',
      value: 'lastupdate',
      options: [
        { label: '更新时间', value: 'lastupdate' },
        { label: '周点击', value: 'weekvisit' },
        { label: '月点击', value: 'monthvisit' },
        { label: '周推荐', value: 'weekvote' },
        { label: '月推荐', value: 'monthvote' },
        { label: '周鲜花', value: 'weekflower' },
        { label: '月鲜花', value: 'monthflower' },
        { label: '收藏数', value: 'goodnum' },
        { label: '入库时间', value: 'postdate' },
      ],
      type: FilterTypes.Picker,
    },
    region: {
      label: '文库地区',
      value: '0',
      options: [
        { label: '不限', value: '0' },
        { label: '日本轻小说', value: '1' },
        { label: '华文轻小说', value: '2' },
        { label: 'Web轻小说', value: '3' },
        { label: '轻改漫画', value: '4' },
        { label: '韩国轻小说', value: '5' },
      ],
      type: FilterTypes.Picker,
    },
    tag: {
      label: '作品主题',
      value: '0',
      options: [
        { label: '不限', value: '0' },
        { label: '恋爱', value: '64' },
        { label: '后宫', value: '48' },
        { label: '校园', value: '63' },
        { label: '百合', value: '27' },
        { label: '转生', value: '26' },
        { label: '异世界', value: '47' },
        { label: '奇幻', value: '15' },
        { label: '冒险', value: '61' },
        { label: '欢乐向', value: '222' },
        { label: '女性视角', value: '231' },
        { label: '龙傲天', value: '219' },
        { label: '魔法', value: '96' },
        { label: '青春', value: '67' },
        { label: '性转', value: '31' },
        { label: '病娇', value: '198' },
        { label: '妹妹', value: '217' },
        { label: '青梅竹马', value: '225' },
        { label: '战斗', value: '18' },
        { label: 'NTR', value: '256' },
        { label: '人外', value: '223' },
        { label: '大小姐', value: '227' },
        { label: '黑暗', value: '189' },
        { label: '悬疑', value: '68' },
        { label: '科幻', value: '56' },
        { label: '伪娘', value: '201' },
        { label: '战争', value: '55' },
        { label: '萝莉', value: '185' },
        { label: '复仇', value: '229' },
        { label: '斗智', value: '199' },
        { label: '异能', value: '131' },
        { label: '猎奇', value: '241' },
        { label: '轻文学', value: '191' },
        { label: '职场', value: '60' },
        { label: '经营', value: '226' },
        { label: 'JK', value: '246' },
        { label: '机战', value: '135' },
        { label: '女儿', value: '261' },
        { label: '末日', value: '221' },
        { label: '犯罪', value: '220' },
        { label: '旅行', value: '239' },
        { label: '惊悚', value: '124' },
        { label: '治愈', value: '98' },
        { label: '推理', value: '97' },
        { label: '日本文学', value: '205' },
        { label: '游戏', value: '248' },
        { label: '耽美', value: '228' },
        { label: '美食', value: '211' },
        { label: '群像', value: '245' },
        { label: '大逃杀', value: '249' },
        { label: '音乐', value: '233' },
        { label: '格斗', value: '132' },
        { label: '热血', value: '28' },
        { label: '温馨', value: '180' },
        { label: '脑洞', value: '224' },
        { label: '恶役', value: '328' },
        { label: 'JC', value: '304' },
        { label: '间谍', value: '254' },
        { label: '竞技', value: '146' },
        { label: '宅文化', value: '263' },
        { label: '同人', value: '333' },
      ],
      type: FilterTypes.Picker,
    },
    progress: {
      label: '写作进度',
      value: '0',
      options: [
        { label: '不限', value: '0' },
        { label: '新书上传', value: '1' },
        { label: '情节展开', value: '2' },
        { label: '精彩纷呈', value: '3' },
        { label: '接近尾声', value: '4' },
        { label: '已经完本', value: '5' },
      ],
      type: FilterTypes.Picker,
    },
    anime: {
      label: '是否动画化',
      value: '0',
      options: [
        { label: '不限', value: '0' },
        { label: '已动画化', value: '1' },
        { label: '未动画化', value: '2' },
      ],
      type: FilterTypes.Picker,
    },
    words: {
      label: '作品字数',
      value: '0',
      options: [
        { label: '不限', value: '0' },
        { label: '30万以下', value: '1' },
        { label: '30-50万', value: '2' },
        { label: '50-100万', value: '3' },
        { label: '100-200万', value: '4' },
        { label: '200万以上', value: '5' },
      ],
      type: FilterTypes.Picker,
    },
    updated: {
      label: '更新时间',
      value: '0',
      options: [
        { label: '不限', value: '0' },
        { label: '三日内', value: '1' },
        { label: '七日内', value: '2' },
        { label: '半月内', value: '3' },
        { label: '一月内', value: '4' },
      ],
      type: FilterTypes.Picker,
    },
  } satisfies Filters;
}

export default new Linovelib();
