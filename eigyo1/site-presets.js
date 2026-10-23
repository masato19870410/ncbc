// 検索対象サイトのプリセット（web_search の allowed_domains に渡す）
const SITE_PRESETS = {
  indeed: { label:"Indeed", domains:["indeed.com"],
    hint:"Indeedで求人を出している企業を優先的に探す。求人を出しているのにWebサイトが無い/古い企業は特に有望な見込み客。" },
  gmap: { label:"Googleマップ", domains:["google.com/maps","maps.google.com"],
    hint:"Googleマップの掲載情報を中心に探す。" },
  epark: { label:"エキテン", domains:["ekiten.jp"],
    hint:"エキテン掲載店舗を中心に探す。" },
  hotpepper: { label:"ホットペッパー", domains:["hotpepper.jp","beauty.hotpepper.jp"],
    hint:"ホットペッパー掲載店舗を中心に探す。" },
};
